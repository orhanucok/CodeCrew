import { ModelUseCase, ProviderId, ProviderModel } from "./types";

const codingUseCases: ModelUseCase[] = ["patch", "explain", "planning", "review", "tests", "general"];

export function providerModel(
  providerId: ProviderId,
  id: string,
  displayName: string,
  options: Partial<ProviderModel> = {}
): ProviderModel {
  return {
    providerId,
    id,
    displayName,
    isFreeTier: true,
    isPaid: false,
    supportsCoding: true,
    supportsReasoning: true,
    supportsStructuredOutput: true,
    recommendedUseCases: codingUseCases,
    ...options
  };
}
