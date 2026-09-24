import { Study } from "./models";
import type { StudyReply } from "../services/ai";

export function commitReply(
  state: Study,
  input: string,
  response: StudyReply,
  answered: number,
): Study {
  return {
    ...state,
    assess: state.assess ? { ...state.assess, asked: answered } : null,
    profile: response.memory || state.profile,
    phase: response.plan ? "reading" : state.phase,
    plan: response.plan || state.plan,
    qa: {
      messages: [
        ...(state.qa?.messages || []),
        { role: "user", content: input, ts: Date.now() },
        {
          role: "assistant",
          content: JSON.stringify({
            reply: response.reply,
            question: response.question,
          }),
          ts: Date.now(),
        },
      ],
    },
  };
}
