import { Storage } from "../storage";
import { OpenAICompatibleProvider } from "./openAICompatibleProvider";
import { providerModel } from "./staticModels";

export class CerebrasProvider extends OpenAICompatibleProvider {
  readonly id = "cerebras" as const;
  readonly displayName = "Cerebras";
  readonly priority = 2;
  protected readonly secretSlot = "cerebras" as const;
  protected readonly baseUrl = "https://api.cerebras.ai/v1";
  protected readonly models = [
    providerModel(this.id, "qwen-3-32b", "Qwen 3 32B"),
    providerModel(this.id, "llama3.1-8b", "Llama 3.1 8B")
  ];
  constructor(storage: Storage) { super(storage); }
}
