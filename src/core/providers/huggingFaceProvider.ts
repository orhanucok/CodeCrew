import { Storage } from "../storage";
import { OpenAICompatibleProvider } from "./openAICompatibleProvider";
import { providerModel } from "./staticModels";

export class HuggingFaceProvider extends OpenAICompatibleProvider {
  readonly id = "huggingface" as const;
  readonly displayName = "Hugging Face";
  readonly priority = 8;
  protected readonly secretSlot = "huggingface" as const;
  protected readonly baseUrl = "https://router.huggingface.co/v1";
  protected readonly models = [
    providerModel(this.id, "Qwen/Qwen2.5-Coder-32B-Instruct", "Qwen 2.5 Coder 32B"),
    providerModel(this.id, "meta-llama/Llama-3.3-70B-Instruct", "Llama 3.3 70B")
  ];
  constructor(storage: Storage) { super(storage); }
}
