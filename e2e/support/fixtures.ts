import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

/**
 * Browser-test fixtures (ticket 09).
 *
 * Every test builds its own tenant: users through the Supabase admin API, then
 * the organization and client through the real product RPCs (`create_organization`
 * / `create_client`), so nothing depends on rows left behind by another run.
 * Cleanup removes the whole tenant.
 *
 * The Playwright runner does not load `.env.local`; this module reads the same
 * file the app uses so the fixtures talk to the same local instance.
 */

function loadLocalEnv(): void {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
}

loadLocalEnv();

export const TEST_PASSWORD = "password123";

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export interface TestWorkspace {
  owner: TestUser;
  organizationId: string;
  clientId: string;
}

export class WorkspaceFixture {
  private readonly url: string;
  private readonly anonKey: string;
  private readonly admin: SupabaseClient;
  private readonly createdUserIds: string[] = [];
  private readonly createdOrgIds: string[] = [];

  constructor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      throw new Error(
        "E2E fixtures need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and " +
          "SUPABASE_SERVICE_ROLE_KEY in .env.local."
      );
    }
    this.url = url;
    this.anonKey = anonKey;
    this.admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  /** Create a confirmed user whose session the browser can obtain through /login. */
  async createUser(prefix = "user"): Promise<TestUser> {
    const email = `${prefix}-${randomUUID()}@example.com`;
    const { data, error } = await this.admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);
    this.createdUserIds.push(data.user.id);
    return { id: data.user.id, email, password: TEST_PASSWORD };
  }

  /** Programmatic sign-in, used for RPC setup only (browser tests use /login). */
  async signIn(user: TestUser): Promise<SupabaseClient> {
    const client = createClient(this.url, this.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await client.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    });
    if (error) throw new Error(`signIn failed: ${error.message}`);
    return client;
  }

  /**
   * Service-role client for asserting browser-to-database persistence and for
   * seeding states the UI cannot create itself (e.g. an AI-only pending
   * Signal). RLS is bypassed here on purpose: it is the test's observation
   * channel, never a path the application code may use for user-facing reads.
   */
  serviceRoleClient(): SupabaseClient {
    return this.admin;
  }

  /**
   * Agent client bound to one user session, used to prove that the database —
   * not the UI — denies an unassigned or read-only user.
   */
  userClient(user: TestUser): Promise<SupabaseClient> {
    return this.signIn(user);
  }

  /** Owner creates an organization and its first client through the product RPCs. */
  async createWorkspace(displayName = "E2E клиент"): Promise<TestWorkspace> {
    const owner = await this.createUser("owner");
    const ownerClient = await this.signIn(owner);
    const { data: organizationId, error } = await ownerClient.rpc("create_organization", {
      org_name: `E2E ${randomUUID().slice(0, 8)}`,
    });
    if (error) throw new Error(`create_organization failed: ${error.message}`);
    this.createdOrgIds.push(organizationId as string);

    const clientId = await this.addClient(ownerClient, organizationId as string, displayName);
    return { owner, organizationId: organizationId as string, clientId };
  }

  /** Add one more client to an existing organization as its owner. */
  async addClient(
    ownerClient: SupabaseClient,
    organizationId: string,
    displayName: string
  ): Promise<string> {
    const { data: clientId, error } = await ownerClient.rpc("create_client", {
      p_organization_id: organizationId,
      p_display_name: displayName,
    });
    if (error) throw new Error(`create_client failed: ${error.message}`);
    return clientId as string;
  }

  async addMember(
    organizationId: string,
    user: TestUser,
    role: "specialist" | "supervisor" = "specialist"
  ): Promise<void> {
    const { error } = await this.admin
      .from("organization_members")
      .insert({ organization_id: organizationId, user_id: user.id, role, status: "active" });
    if (error) throw new Error(`addMember failed: ${error.message}`);
  }

  async assign(clientId: string, user: TestUser, accessRole: string): Promise<void> {
    const { error } = await this.admin
      .from("client_assignments")
      .insert({ client_id: clientId, user_id: user.id, access_role: accessRole });
    if (error) throw new Error(`assign failed: ${error.message}`);
  }

  /** Remove the whole tenant: organizations cascade to clients/assignments/consent. */
  async cleanup(): Promise<void> {
    if (this.createdOrgIds.length > 0) {
      await this.admin.from("organizations").delete().in("id", this.createdOrgIds);
    }
    for (const id of this.createdUserIds) {
      await this.admin.auth.admin.deleteUser(id);
    }
  }
}

/** Sign in through the real /login form, exactly like a specialist would. */
export async function signInThroughLoginForm(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Пароль").fill(user.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

/** The workspace section navigation of the client currently open. */
export function workspaceNav(page: Page) {
  return page.getByRole("navigation", { name: "Разделы клиента" });
}
