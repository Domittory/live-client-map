import { describe, expect, it } from "vitest";
import { buildTimeline, type TimelineRows, type TimelineSessionRow } from "@/lib/service/dynamics";

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

function emptyRows(): TimelineRows {
  return { sessions: [], corrections: [], followUps: [], modelChanges: [], snapshots: [] };
}

function session(overrides: Partial<TimelineSessionRow>): TimelineSessionRow {
  return {
    id: crypto.randomUUID(),
    title: "Сессия",
    session_type: "individual",
    performed_at: null,
    created_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildTimeline (ticket 49)", () => {
  it("returns an empty timeline for empty input — no synthesized conclusions", () => {
    expect(buildTimeline(CLIENT_ID, emptyRows())).toEqual([]);
  });

  it("orders events chronologically across all sources", () => {
    const events = buildTimeline(CLIENT_ID, {
      sessions: [session({ created_at: "2026-08-01T10:00:00.000Z" })],
      corrections: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          title: "Коррекция",
          status: "planned",
          date: "2026-08-03",
          created_at: "2026-08-03T10:00:00.000Z",
        },
      ],
      followUps: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          correction_id: "22222222-2222-2222-2222-222222222222",
          result_status: "scheduled",
          scheduled_at: "2026-08-02T10:00:00.000Z",
          completed_at: null,
          created_at: "2026-08-03T11:00:00.000Z",
        },
      ],
      modelChanges: [
        {
          id: "44444444-4444-4444-4444-444444444444",
          entity_type: "core_node",
          entity_id: "55555555-5555-5555-5555-555555555555",
          change_reason: "status change",
          occurred_at: "2026-08-04T10:00:00.000Z",
          evidence_refs: [],
        },
      ],
      snapshots: [
        {
          id: "66666666-6666-6666-6666-666666666666",
          version: 1,
          generated_at: "2026-08-05T10:00:00.000Z",
          reason: "плановый",
          model_hash: "a".repeat(64),
        },
      ],
    });

    expect(events.map((event) => event.type)).toEqual([
      "diagnostic_session",
      "follow_up",
      "correction",
      "model_change",
      "snapshot",
    ]);
  });

  it("breaks identical timestamps deterministically by type order, then source id", () => {
    const at = "2026-08-01T10:00:00.000Z";
    const sessionA = session({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", created_at: at });
    const sessionB = session({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", created_at: at });
    const correction = {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      title: "Коррекция",
      status: "planned",
      date: "2026-08-01",
      created_at: at,
    };

    const events = buildTimeline(CLIENT_ID, {
      ...emptyRows(),
      // Intentionally unordered input.
      sessions: [sessionA, sessionB],
      corrections: [correction],
    });

    expect(events.map((event) => [event.type, event.sourceId])).toEqual([
      ["diagnostic_session", sessionB.id],
      ["diagnostic_session", sessionA.id],
      ["correction", correction.id],
    ]);
  });

  it("maps every source row to the right event type, title and routes", () => {
    const changeId = "44444444-4444-4444-4444-444444444444";
    const nodeId = "55555555-5555-5555-5555-555555555555";
    const correctionId = "22222222-2222-2222-2222-222222222222";
    const snapshotId = "66666666-6666-6666-6666-666666666666";

    const events = buildTimeline(CLIENT_ID, {
      sessions: [session({ id: "11111111-1111-1111-1111-111111111112", title: "Диагностика 1" })],
      corrections: [
        {
          id: correctionId,
          title: "Проработка страха",
          status: "completed",
          date: "2026-08-02",
          created_at: "2026-08-02T10:00:00.000Z",
        },
      ],
      followUps: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          correction_id: correctionId,
          result_status: "effective",
          scheduled_at: "2026-08-03T10:00:00.000Z",
          completed_at: "2026-08-04T10:00:00.000Z",
          created_at: "2026-08-03T10:00:00.000Z",
        },
      ],
      modelChanges: [
        {
          id: changeId,
          entity_type: "core_node",
          entity_id: nodeId,
          change_reason: "reactivation approved",
          occurred_at: "2026-08-05T10:00:00.000Z",
          evidence_refs: ["77777777-7777-7777-7777-777777777777"],
        },
      ],
      snapshots: [
        {
          id: snapshotId,
          version: 2,
          generated_at: "2026-08-06T10:00:00.000Z",
          reason: "после диагностики",
          model_hash: "b".repeat(64),
        },
      ],
    });

    const byType = new Map(events.map((event) => [event.type, event]));

    const sessionEvent = byType.get("diagnostic_session")!;
    expect(sessionEvent.title).toBe("Диагностика 1");
    expect(sessionEvent.sourceRoute).toBeNull();

    const correctionEvent = byType.get("correction")!;
    expect(correctionEvent.sourceRoute).toBe(`/corrections/${correctionId}`);

    const followUpEvent = byType.get("follow_up")!;
    expect(followUpEvent.occurredAt).toBe("2026-08-04T10:00:00.000Z"); // completed_at wins
    expect(followUpEvent.sourceRoute).toBe(`/corrections/${correctionId}`);

    const changeEvent = byType.get("model_change")!;
    expect(changeEvent.title).toBe("reactivation approved");
    expect(changeEvent.sourceRoute).toBe(`/core-nodes/${nodeId}`);
    expect(changeEvent.evidenceRoute).toBe(`/clients/${CLIENT_ID}/evidence/core_node/${nodeId}`);

    const snapshotEvent = byType.get("snapshot")!;
    expect(snapshotEvent.title).toBe("Snapshot v2");
    expect(snapshotEvent.sourceRoute).toBe(
      `/snapshots?clientId=${CLIENT_ID}&snapshotId=${snapshotId}`
    );
  });

  it("uses performed_at for sessions and scheduled_at for pending follow-ups", () => {
    const events = buildTimeline(CLIENT_ID, {
      ...emptyRows(),
      sessions: [
        session({
          performed_at: "2026-07-20T10:00:00.000Z",
          created_at: "2026-08-01T10:00:00.000Z",
        }),
      ],
      followUps: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          correction_id: "22222222-2222-2222-2222-222222222222",
          result_status: "scheduled",
          scheduled_at: "2026-07-25T10:00:00.000Z",
          completed_at: null,
          created_at: "2026-08-01T11:00:00.000Z",
        },
      ],
    });

    expect(events.map((event) => event.type)).toEqual(["diagnostic_session", "follow_up"]);
    expect(events[1].occurredAt).toBe("2026-07-25T10:00:00.000Z");
  });

  it("adds an evidence route only for evidence-backed entity types", () => {
    const makeChange = (entityType: string) => ({
      id: crypto.randomUUID(),
      entity_type: entityType,
      entity_id: crypto.randomUUID(),
      change_reason: `change of ${entityType}`,
      occurred_at: "2026-08-01T10:00:00.000Z",
      evidence_refs: [],
    });

    const events = buildTimeline(CLIENT_ID, {
      ...emptyRows(),
      modelChanges: [
        makeChange("theme"),
        makeChange("follow_up"),
        makeChange("differential_hypothesis"),
      ],
    });

    for (const event of events) {
      if (event.details?.startsWith("follow_up")) {
        expect(event.evidenceRoute).toBeNull();
        expect(event.sourceRoute).toBeNull();
      } else {
        expect(event.evidenceRoute).not.toBeNull();
      }
    }
    expect(events).toHaveLength(3);
  });
});
