import { Storage } from "../storage";
import { OpenAICompatibleProvider } from "./openAICompatibleProvider";
import { providerModel } from "./staticModels";

export class MistralProvider extends OpenAICompatibleProvider {
  readonly id = "mistral" as const;
  readonly displayName = "Mistral";
  readonly priority = 6;
  protected readonly secretSlot = "mistral" as const;
  protected readonly baseUrl = "https://api.mistral.ai/v1";
  protected readonly models = [
    providerModel(this.id, "codestral-latest", "Codestral"),
    providerModel(this.id, "mistral-small-latest", "Mistral Small")
  ];
  constructor(storage: Storage) { super(storage); }
}
