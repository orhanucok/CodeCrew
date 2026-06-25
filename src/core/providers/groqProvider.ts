import { Storage } from "../storage";
import { OpenAICompatibleProvider } from "./openAICompatibleProvider";
import { providerModel } from "./staticModels";

export class GroqProvider extends OpenAICompatibleProvider {
  readonly id = "groq" as const;
  readonly displayName = "Groq";
  readonly priority = 3;
  protected readonly secretSlot = "groq" as const;
  protected readonly baseUrl = "https://api.groq.com/openai/v1";
  protected readonly models = [
    providerModel(this.id, "llama-3.3-70b-versatile", "Llama 3.3 70B Versatile"),
    providerModel(this.id, "openai/gpt-oss-20b", "GPT OSS 20B")
  ];
  constructor(storage: Storage) { super(storage); }
}
