import { describe, expect, it } from "vitest";
import { toClientVisible, type ClientRow } from "@/lib/service/clients";

describe("toClientVisible", () => {
  it("excludes private specialist notes from the client-visible projection", () => {
    const client = {
      id: "1",
      organization_id: "org",
      owner_user_id: "user",
      display_name: "Иван",
      specialist_notes_private: "secret",
      client_visible_notes: "visible",
    } as unknown as ClientRow;

    const visible = toClientVisible(client);

    expect(visible).not.toHaveProperty("specialist_notes_private");
    expect(visible.client_visible_notes).toBe("visible");
    expect(visible.display_name).toBe("Иван");
  });
});
