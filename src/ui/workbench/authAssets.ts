import back from "./assets/auth/back.svg";
import google from "./assets/auth/google.svg";
import creditsBase from "./assets/auth/credits-base.svg";
import creditsMonthly from "./assets/auth/credits-monthly.svg";
import socialImport from "./assets/auth/social-import.svg";
import autoTag from "./assets/auth/auto-tag.svg";
import eye from "./assets/auth/eye.svg";
import eyeClosed from "./assets/auth/eye-closed.svg";
import check from "./assets/auth/check.svg";

/** Original assets from Figma design reference and design reference. */
export const authAssets = {
  imgIconBack: back,
  imgFrame: google,
  benefitCreditsBase: creditsBase,
  benefitCreditsMonthly: creditsMonthly,
  benefitSocialEagle: socialImport,
  benefitAutoTag: autoTag,
  imgEye: eye,
  imgEyeClosed: eyeClosed,
  imgCheck: check
} as const;
