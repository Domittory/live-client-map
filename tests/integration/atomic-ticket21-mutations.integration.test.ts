import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLifeEvent, createTrigger } from "@/lib/service/life-events";
import { createRelationship, createRelationshipDynamic } from "@/lib/service/relationships";
import {
  changeGoalStatus,
  changeRequestStatus,
  createGoal,
  createRequest,
} from "@/lib/service/requests";
import { connectFaultInjection, type FaultInjection } from "./support/fault-injection";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

/**
 * Ticket 21: the last mutation-then-audit pairs (life events, triggers,
 * relationships, relationship dynamics, client requests and client goals) moved
 * into atomic RPCs (migration 0053).
 *
 * This suite proves the two failure modes the ticket cares about, at BOTH ends
 * of each transaction:
 *   * a fault on the domain write (or the intermediate child write) rolls back
 *     the transaction, so no domain row survives;
 *   * a fault on the AuditLog append rolls back the transaction too, so a
 *     committed domain row can never be missing its audit trail.
 *
 * Faults come from the local-only `test_support` schema created by
 * `supabase/seed.sql`; when it is missing the whole suite is skipped.
 */
describe.skipIf(!available)(
  "atomic ticket-21 mutations (life events, relationships, requests)",
  () => {
    const admin = createClient(url!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const createdUserIds: string[] = [];
    let faults: FaultInjection;
    let organizationId: string;
    let clientAId: string;
    let clientBId: string;
    let specialist: { id: string; client: SupabaseClient };

    function anonClient() {
      return createClient(url!, anonKey!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }

    async function createUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: "password123",
        email_confirm: true,
      });
      if (error) throw new Error(error.message);
      createdUserIds.push(data.user!.id);

      const client = anonClient();
      await client.auth.signInWithPassword({ email, password: "password123" });
      return { id: data.user!.id, client };
    }

    /** Count rows of a client-scoped table carrying this unique title marker. */
    async function countByTitle(table: string, title: string): Promise<number> {
      const { data, error } = await admin.from(table).select("id").eq("title", title);
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    }

    /** Create a plain client through the atomic create_client RPC. */
    async function createClientRow(displayName: string): Promise<string> {
      const { data, error } = await specialist.client.rpc("create_client", {
        p_organization_id: organizationId,
        p_display_name: displayName,
      });
      if (error) throw new Error(error.message);
      return data as string;
    }

    /**
     * Create two fresh consented clients and one relationship between them, so
     * every relationship-dynamic case starts from its own pair (the
     * (client_a_id, client_b_id) unique constraint would otherwise collide).
     */
    async function createRelationshipForFreshPair(): Promise<string> {
      const pairA = await createClientRow(`t21-dynamic-pair-a-${crypto.randomUUID()}`);
      const pairB = await createClientRow(`t21-dynamic-pair-b-${crypto.randomUUID()}`);
      for (const clientId of [pairA, pairB]) {
        await admin.from("consent_records").insert({
          organization_id: organizationId,
          client_id: clientId,
          consent_type: "relationship_analysis",
          document_version: "1.0",
        });
      }
      return createRelationship(specialist.client, {
        organizationId,
        clientAId: pairA,
        clientBId: pairB,
        relationshipType: "couple",
      });
    }

    beforeAll(async () => {
      faults = await connectFaultInjection();
      // A fault case that silently runs without fault support would prove nothing,
      // so the suite refuses to run instead of reporting green.
      expect(faults.available, "test_support.faults must exist (run `supabase db reset`)").toBe(
        true
      );

      const owner = await createUser(`t21-owner-${crypto.randomUUID()}@example.com`);
      const { data: org } = await owner.client.rpc("create_organization", {
        org_name: "Ticket 21 Atomic Org",
      });
      organizationId = org as string;

      specialist = await createUser(`t21-spec-${crypto.randomUUID()}@example.com`);
      await admin.from("organization_members").insert({
        organization_id: organizationId,
        user_id: specialist.id,
        role: "specialist",
        status: "active",
      });

      const { data: clientA } = await specialist.client.rpc("create_client", {
        p_organization_id: organizationId,
        p_display_name: "Ticket 21 Client A",
      });
      clientAId = clientA as string;
      const { data: clientB } = await specialist.client.rpc("create_client", {
        p_organization_id: organizationId,
        p_display_name: "Ticket 21 Client B",
      });
      clientBId = clientB as string;

      // Both relationship clients need active `relationship_analysis` consent.
      for (const clientId of [clientAId, clientBId]) {
        await admin.from("consent_records").insert({
          organization_id: organizationId,
          client_id: clientId,
          consent_type: "relationship_analysis",
          document_version: "1.0",
        });
      }
    });

    afterAll(async () => {
      await faults?.clear();
      await faults?.close();
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    });

    it("create_life_event rolls back when the audit append fails", async () => {
      const title = `t21-life-audit-${crypto.randomUUID()}`;
      await faults.register("audit_log", title, specialist.id);

      await expect(
        createLifeEvent(specialist.client, organizationId, { clientId: clientAId, title })
      ).rejects.toThrow();

      expect(await countByTitle("life_events", title)).toBe(0);
      const { data: audit } = await admin
        .from("audit_log")
        .select("id")
        .eq("action", "life_event.created")
        .eq("after_data->>title", title);
      expect(audit ?? []).toHaveLength(0);
    });

    it("create_life_event rolls back when the domain write fails", async () => {
      const title = `t21-life-domain-${crypto.randomUUID()}`;
      await faults.register("life_events", title, specialist.id);

      await expect(
        createLifeEvent(specialist.client, organizationId, { clientId: clientAId, title })
      ).rejects.toThrow();

      expect(await countByTitle("life_events", title)).toBe(0);
      const { data: audit } = await admin
        .from("audit_log")
        .select("id")
        .eq("action", "life_event.created")
        .eq("after_data->>title", title);
      expect(audit ?? []).toHaveLength(0);
    });

    it("create_trigger rolls back when the audit append fails", async () => {
      const title = `t21-trigger-audit-${crypto.randomUUID()}`;
      await faults.register("audit_log", title, specialist.id);

      await expect(
        createTrigger(specialist.client, organizationId, { clientId: clientAId, title })
      ).rejects.toThrow();

      expect(await countByTitle("triggers", title)).toBe(0);
    });

    it("create_trigger rolls back when the domain write fails", async () => {
      const title = `t21-trigger-domain-${crypto.randomUUID()}`;
      await faults.register("triggers", title, specialist.id);

      await expect(
        createTrigger(specialist.client, organizationId, { clientId: clientAId, title })
      ).rejects.toThrow();

      expect(await countByTitle("triggers", title)).toBe(0);
    });

    it("create_relationship rolls back when the audit append fails", async () => {
      // A fresh client pair, so the unique (client_a_id, client_b_id) constraint
      // cannot mask the rollback assertion. The unique relationship_type is also
      // the fault marker: it lands in the domain row first, so a transaction that
      // committed the row and then failed on the audit append would be caught.
      const pairA = await createClientRow(`t21-audit-pair-a-${crypto.randomUUID()}`);
      const pairB = await createClientRow(`t21-audit-pair-b-${crypto.randomUUID()}`);
      for (const clientId of [pairA, pairB]) {
        await admin.from("consent_records").insert({
          organization_id: organizationId,
          client_id: clientId,
          consent_type: "relationship_analysis",
          document_version: "1.0",
        });
      }

      const marker = `couple-${crypto.randomUUID()}`;
      await faults.register("relationships", marker, specialist.id);

      await expect(
        createRelationship(specialist.client, {
          organizationId,
          clientAId: pairA,
          clientBId: pairB,
          relationshipType: marker,
        })
      ).rejects.toThrow();

      await faults.clear();

      const { data: relationships } = await admin
        .from("relationships")
        .select("id")
        .in("client_a_id", [pairA, pairB]);
      expect(relationships ?? []).toHaveLength(0);
    });

    it("create_relationship_dynamic rolls back when the audit append fails", async () => {
      const relationshipId = await createRelationshipForFreshPair();

      const title = `t21-dynamic-audit-${crypto.randomUUID()}`;
      await faults.register("audit_log", title, specialist.id);

      await expect(
        createRelationshipDynamic(specialist.client, {
          organizationId,
          relationshipId,
          title,
        })
      ).rejects.toThrow();

      expect(await countByTitle("relationship_dynamics", title)).toBe(0);
    });

    it("create_relationship_dynamic rolls back when the domain write fails", async () => {
      const relationshipId = await createRelationshipForFreshPair();

      const title = `t21-dynamic-domain-${crypto.randomUUID()}`;
      await faults.register("relationship_dynamics", title, specialist.id);

      await expect(
        createRelationshipDynamic(specialist.client, {
          organizationId,
          relationshipId,
          title,
        })
      ).rejects.toThrow();

      expect(await countByTitle("relationship_dynamics", title)).toBe(0);
    });

    it("create_client_request rolls back when the audit append fails", async () => {
      const title = `t21-request-audit-${crypto.randomUUID()}`;
      await faults.register("audit_log", title, specialist.id);

      await expect(
        createRequest(specialist.client, organizationId, { clientId: clientAId, title })
      ).rejects.toThrow();

      expect(await countByTitle("client_requests", title)).toBe(0);
    });

    it("change_request_status keeps both row and audit when the audit append fails", async () => {
      const title = `t21-request-transition-${crypto.randomUUID()}`;
      const requestId = await createRequest(specialist.client, organizationId, {
        clientId: clientAId,
        title,
      });

      // The row id is the fault marker: it is unique, it lands in the audit row
      // as entity_id, so the audit append fails while the domain row would already
      // have been written by a non-transactional implementation.
      await faults.register("audit_log", requestId, specialist.id);

      await expect(
        changeRequestStatus(specialist.client, organizationId, requestId, "paused")
      ).rejects.toThrow();

      await faults.clear();

      const { data: request } = await admin
        .from("client_requests")
        .select("status")
        .eq("id", requestId)
        .maybeSingle();
      expect(request?.status).toBe("active");

      const { data: transitionAudit } = await admin
        .from("audit_log")
        .select("id")
        .eq("entity_id", requestId)
        .eq("action", "request.paused");
      expect(transitionAudit ?? []).toHaveLength(0);
    });

    it("create_client_goal rolls back when the audit append fails", async () => {
      const title = `t21-goal-audit-${crypto.randomUUID()}`;
      await faults.register("audit_log", title, specialist.id);

      await expect(
        createGoal(specialist.client, organizationId, { clientId: clientAId, title })
      ).rejects.toThrow();

      expect(await countByTitle("client_goals", title)).toBe(0);
    });

    it("change_goal_status keeps both row and audit when the audit append fails", async () => {
      const title = `t21-goal-transition-${crypto.randomUUID()}`;
      const goalId = await createGoal(specialist.client, organizationId, {
        clientId: clientAId,
        title,
      });

      // The row id is the fault marker — see the request transition case above.
      await faults.register("audit_log", goalId, specialist.id);

      await expect(
        changeGoalStatus(specialist.client, organizationId, goalId, "completed")
      ).rejects.toThrow();

      await faults.clear();

      const { data: goal } = await admin
        .from("client_goals")
        .select("status")
        .eq("id", goalId)
        .maybeSingle();
      expect(goal?.status).toBe("active");

      const { data: transitionAudit } = await admin
        .from("audit_log")
        .select("id")
        .eq("entity_id", goalId)
        .eq("action", "goal.completed");
      expect(transitionAudit ?? []).toHaveLength(0);
    });
  }
);
