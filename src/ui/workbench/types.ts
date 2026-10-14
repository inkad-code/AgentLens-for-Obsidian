import type { MediaPolicy } from "../../core/domain";
import type { FrequencyUnit } from "../../api/AgentLensApiClient";
import type { Locale } from "../../i18n/catalog";

export type TemplateId = "default" | "compact";
export type WorkbenchTab = "single" | "bulk" | "auto";

export interface WorkbenchDefaults {
  locale?: Locale | undefined;
  folderPath: string;
  templateId: TemplateId;
  mediaPolicy: MediaPolicy;
  autoEvery: number;
  autoUnit: FrequencyUnit;
  autoPreferredTime: string;
}
