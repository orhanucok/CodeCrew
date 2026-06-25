import { Storage } from "../storage";
import { OpenAICompatibleProvider } from "./openAICompatibleProvider";
import { providerModel } from "./staticModels";

export class GitHubModelsProvider extends OpenAICompatibleProvider {
  readonly id = "github-models" as const;
  readonly displayName = "GitHub Models";
  readonly priority = 5;
  protected readonly secretSlot = "github-models" as const;
  protected readonly baseUrl = "https://models.github.ai/inference";
  protected readonly models = [
    providerModel(this.id, "openai/gpt-4.1-mini", "GPT-4.1 Mini"),
    providerModel(this.id, "meta/Llama-3.3-70B-Instruct", "Llama 3.3 70B Instruct")
  ];
  protected additionalHeaders(): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }
  constructor(storage: Storage) { super(storage); }
}
