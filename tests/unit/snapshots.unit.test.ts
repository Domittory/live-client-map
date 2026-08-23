import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_CATEGORIES,
  canonicalJson,
  computeModelHash,
  diffSnapshots,
  type SnapshotContent,
  type SnapshotItem,
  type SnapshotVersions,
} from "@/lib/service/snapshots";

const VERSIONS: SnapshotVersions = {
  scoring_model_version: "1.0.0",
  ontology_version: "1.0",
  ai_model: "gpt-5.5-2026-04-23",
  prompt_version: "prompt.generate-snapshot.v1",
};

function emptyContent(): SnapshotContent {
  return Object.fromEntries(SNAPSHOT_CATEGORIES.map((category) => [category, []])) as never;
}

function contentWith(category: keyof SnapshotContent, items: SnapshotItem[]): SnapshotContent {
  return { ...emptyContent(), [category]: items };
}

describe("canonicalJson", () => {
  it("is stable regardless of object key order", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it("is stable regardless of array order", () => {
    const a = canonicalJson([
      { id: "1", v: 10 },
      { id: "2", v: 20 },
    ]);
    const b = canonicalJson([
      { id: "2", v: 20 },
      { id: "1", v: 10 },
    ]);
    expect(a).toBe(b);
  });

  it("treats null and missing keys differently from present values", () => {
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({ a: 0 }));
    expect(canonicalJson({ a: undefined })).toBe(canonicalJson({}));
  });

  it("distinguishes different content", () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([1, 3]));
  });
});

describe("computeModelHash", () => {
  it("same content and versions give the same hash (repeatability)", () => {
    const content = contentWith("active_core_nodes", [
      { id: "node-1", title: "Узел", status: "active", confidence_score: 72 },
    ]);
    expect(computeModelHash(content, VERSIONS)).toBe(computeModelHash(content, VERSIONS));
  });

  it("key and array order do not affect the hash", () => {
    const a = contentWith("active_core_nodes", [
      { id: "1", title: "A", status: "active" },
      { id: "2", title: "B", status: "active" },
    ]);
    const b = contentWith("active_core_nodes", [
      { status: "active", title: "B", id: "2" },
      { status: "active", id: "1", title: "A" },
    ]);
    expect(computeModelHash(a, VERSIONS)).toBe(computeModelHash(b, VERSIONS));
  });

  it("any content difference changes the hash", () => {
    const a = contentWith("active_core_nodes", [{ id: "1", confidence_score: 72 }]);
    const b = contentWith("active_core_nodes", [{ id: "1", confidence_score: 88 }]);
    expect(computeModelHash(a, VERSIONS)).not.toBe(computeModelHash(b, VERSIONS));
  });

  it("any version difference changes the hash", () => {
    const content = emptyContent();
    const other = { ...VERSIONS, scoring_model_version: "2.0.0" };
    expect(computeModelHash(content, VERSIONS)).not.toBe(computeModelHash(content, other));
  });
});

describe("diffSnapshots", () => {
  it("reports added, removed and changed items per category", () => {
    const previous = contentWith("active_core_nodes", [
      { id: "1", status: "active", confidence_score: 72 },
      { id: "2", status: "active" },
    ]);
    const current = contentWith("active_core_nodes", [
      { id: "1", status: "active", confidence_score: 88 }, // changed
      { id: "3", status: "active" }, // added
    ]);

    const diff = diffSnapshots(previous, current);
    expect(diff.active_core_nodes.added).toEqual(["3"]);
    expect(diff.active_core_nodes.removed).toEqual(["2"]);
    expect(diff.active_core_nodes.changed).toHaveLength(1);
    expect(diff.active_core_nodes.changed[0].id).toBe("1");
    expect(diff.active_core_nodes.changed[0].before.confidence_score).toBe(72);
    expect(diff.active_core_nodes.changed[0].after.confidence_score).toBe(88);
  });

  it("reports an empty diff for identical contents", () => {
    const content = contentWith("active_themes", [{ id: "t1", name: "Тема", status: "active" }]);
    const diff = diffSnapshots(content, content);
    for (const category of SNAPSHOT_CATEGORIES) {
      expect(diff[category].added).toEqual([]);
      expect(diff[category].removed).toEqual([]);
      expect(diff[category].changed).toEqual([]);
    }
  });

  it("covers every SPEC §25 category", () => {
    const diff = diffSnapshots(emptyContent(), emptyContent());
    expect(Object.keys(diff).sort()).toEqual([...SNAPSHOT_CATEGORIES].sort());
  });
});
