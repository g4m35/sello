import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  createPartFromBase64: vi.fn(),
  GoogleGenAI: class { models = { generateContent: mocks.generateContent }; },
}));
vi.mock("./listing-draft", () => ({ geminiListingDraftResponseSchema: {}, parseGeminiListingDraft: () => ({}) }));
import { generateListingDraftWithGemini } from "./gemini";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("GEMINI_API_KEY", "synthetic-test-key"); mocks.generateContent.mockResolvedValue({ text: "{}" }); });
describe("Gemini request bounds", () => {
  it("passes the abort signal and timeout to the installed SDK boundary", async () => {
    const controller = new AbortController();
    await generateListingDraftWithGemini([], { signal: controller.signal, timeoutMs: 12_000 });
    expect(mocks.generateContent).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ abortSignal: controller.signal, httpOptions: { timeout: 12_000 } }) }));
  });
  it("has a finite default for existing callers", async () => {
    await generateListingDraftWithGemini([]);
    expect(mocks.generateContent).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ httpOptions: { timeout: 120_000 } }) }));
  });
});
