import { describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/service/errors";
import {
  FEEDBACK_QUESTION_TYPES,
  createFeedbackFormSchema,
  feedbackQuestionSchema,
  formatFeedbackAnswers,
  listFeedbackFormsQuerySchema,
  submitFeedbackFormSchema,
} from "@/lib/service/feedback-forms";
import { validate } from "@/lib/service/validation";

/**
 * Feedback form service contracts (ticket 16).
 *
 * These pin the parts the UI and the atomic RPC share: the strict question
 * schema (a form is never sent to the database with an unknown question type),
 * the answer payload shape, and the answer rendering used by the specialist
 * review view. The database transaction itself is covered by the integration
 * suite.
 */

const ORG_ID = "123e4567-e89b-12d3-a456-426614174000";
const CLIENT_ID = "223e4567-e89b-12d3-a456-426614174000";
const FORM_ID = "323e4567-e89b-12d3-a456-426614174000";

describe("createFeedbackFormSchema", () => {
  it("accepts a titled form with one typed question", () => {
    const input = validate(createFeedbackFormSchema, {
      organizationId: ORG_ID,
      clientId: CLIENT_ID,
      title: "Обратная связь",
      questions: [{ key: "mood", label: "Как настроение?", type: "scale_1_10", required: true }],
    });
    expect(input.title).toBe("Обратная связь");
    expect(input.questions).toHaveLength(1);
  });

  it("requires at least one question", () => {
    expect(() =>
      validate(createFeedbackFormSchema, {
        organizationId: ORG_ID,
        clientId: CLIENT_ID,
        title: "Пустая",
        questions: [],
      })
    ).toThrow(ServiceError);
  });

  it("rejects an unknown question type and unknown fields", () => {
    expect(() =>
      validate(createFeedbackFormSchema, {
        organizationId: ORG_ID,
        clientId: CLIENT_ID,
        title: "Форма",
        questions: [{ key: "q", label: "Вопрос", type: "free_form" }],
      })
    ).toThrow(ServiceError);
    expect(() =>
      validate(createFeedbackFormSchema, {
        organizationId: ORG_ID,
        clientId: CLIENT_ID,
        title: "Форма",
        questions: [{ key: "q", label: "Вопрос", type: "text" }],
        status: "sent",
      })
    ).toThrow(ServiceError);
  });

  it("defaults `required` to false", () => {
    const parsed = feedbackQuestionSchema.parse({ key: "q", label: "Вопрос", type: "yes_no" });
    expect(parsed.required).toBeUndefined();
  });

  it("exposes exactly the three supported question types", () => {
    expect(FEEDBACK_QUESTION_TYPES).toEqual(["scale_1_10", "text", "yes_no"]);
  });
});

describe("submitFeedbackFormSchema / listFeedbackFormsQuerySchema", () => {
  it("accepts any JSON-serialisable answer map", () => {
    const input = validate(submitFeedbackFormSchema, {
      formId: FORM_ID,
      answers: { mood: 7, note: "спокойнее" },
    });
    expect(input.answers).toEqual({ mood: 7, note: "спокойнее" });
  });

  it("rejects a malformed form id", () => {
    expect(() => validate(submitFeedbackFormSchema, { formId: "nope", answers: {} })).toThrow(
      ServiceError
    );
  });

  it("scopes the specialist list to one organization and client", () => {
    const query = validate(listFeedbackFormsQuerySchema, {
      organizationId: ORG_ID,
      clientId: CLIENT_ID,
    });
    expect(query.clientId).toBe(CLIENT_ID);
    expect(() => validate(listFeedbackFormsQuerySchema, { organizationId: ORG_ID })).toThrow(
      ServiceError
    );
  });
});

describe("formatFeedbackAnswers", () => {
  const questions = [
    { key: "mood", label: "Настроение", type: "scale_1_10" as const },
    { key: "note", label: "Комментарий", type: "text" as const },
  ];

  it("renders one line per answered question, in question order", () => {
    expect(formatFeedbackAnswers(questions, { note: "лучше", mood: 8 })).toEqual([
      "Настроение: 8",
      "Комментарий: лучше",
    ]);
  });

  it("skips unanswered questions and renders an empty answer as a dash", () => {
    expect(formatFeedbackAnswers(questions, { mood: null })).toEqual(["Настроение: —"]);
    expect(formatFeedbackAnswers(questions, null)).toEqual([]);
  });

  it("serialises non-scalar answers instead of leaking [object Object]", () => {
    expect(formatFeedbackAnswers(questions, { note: { a: 1 } })).toEqual(['Комментарий: {"a":1}']);
  });
});
