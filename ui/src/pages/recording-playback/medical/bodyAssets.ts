import background from "../../../assets/medical/body/background.png";
import head from "../../../assets/medical/body/head.png";
import headS from "../../../assets/medical/body/head_s.png";
import torso from "../../../assets/medical/body/torso.png";
import torsoS from "../../../assets/medical/body/torso_s.png";
import armLeft from "../../../assets/medical/body/arm_left.png";
import armLeftS from "../../../assets/medical/body/arm_left_s.png";
import armLeftT from "../../../assets/medical/body/arm_left_t.png";
import armLeftB from "../../../assets/medical/body/arm_left_b.png";
import armRight from "../../../assets/medical/body/arm_right.png";
import armRightS from "../../../assets/medical/body/arm_right_s.png";
import armRightT from "../../../assets/medical/body/arm_right_t.png";
import armRightB from "../../../assets/medical/body/arm_right_b.png";
import legLeft from "../../../assets/medical/body/leg_left.png";
import legLeftS from "../../../assets/medical/body/leg_left_s.png";
import legLeftT from "../../../assets/medical/body/leg_left_t.png";
import legLeftB from "../../../assets/medical/body/leg_left_b.png";
import legRight from "../../../assets/medical/body/leg_right.png";
import legRightS from "../../../assets/medical/body/leg_right_s.png";
import legRightT from "../../../assets/medical/body/leg_right_t.png";
import legRightB from "../../../assets/medical/body/leg_right_b.png";
import torsoChestSeal from "../../../assets/medical/body/torso_chestseal.png";
import torsoPneumothorax from "../../../assets/medical/body/torso_pneumothorax.png";
import torsoIo from "../../../assets/medical/body/torso_io.png";
import headGuedel from "../../../assets/medical/body/head_guedeltube.png";
import headKingLt from "../../../assets/medical/body/head_kinglt.png";
import headNasal from "../../../assets/medical/body/head_nasalcannula.png";
import leftArmPulseOx from "../../../assets/medical/body/leftarm_pulseoximeter.png";
import rightArmPulseOx from "../../../assets/medical/body/rightarm_pulseoximeter.png";
import leftArmIv from "../../../assets/medical/body/leftarm_iv.png";
import rightArmIv from "../../../assets/medical/body/rightarm_iv.png";
import leftLegIv from "../../../assets/medical/body/leftleg_iv.png";
import rightLegIv from "../../../assets/medical/body/rightleg_iv.png";
import type { BodyPartId } from "./bodyImage";

export const BODY_BACKGROUND = background;

export const BODY_PART_FILLS: Record<BodyPartId, string> = {
  head,
  body: torso,
  leftarm: armLeft,
  rightarm: armRight,
  leftleg: legLeft,
  rightleg: legRight,
};

export const BODY_OVERLAY_ASSETS: Record<string, string> = {
  head_s: headS,
  torso_s: torsoS,
  arm_left_s: armLeftS,
  arm_left_t: armLeftT,
  arm_left_b: armLeftB,
  arm_right_s: armRightS,
  arm_right_t: armRightT,
  arm_right_b: armRightB,
  leg_left_s: legLeftS,
  leg_left_t: legLeftT,
  leg_left_b: legLeftB,
  leg_right_s: legRightS,
  leg_right_t: legRightT,
  leg_right_b: legRightB,
  torso_chestseal: torsoChestSeal,
  torso_pneumothorax: torsoPneumothorax,
  torso_io: torsoIo,
  head_guedeltube: headGuedel,
  head_kinglt: headKingLt,
  head_nasalcannula: headNasal,
  leftarm_pulseoximeter: leftArmPulseOx,
  rightarm_pulseoximeter: rightArmPulseOx,
  leftarm_iv: leftArmIv,
  rightarm_iv: rightArmIv,
  leftleg_iv: leftLegIv,
  rightleg_iv: rightLegIv,
};
