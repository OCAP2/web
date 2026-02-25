import { C } from "./constants";

export function OcapLogoSvg(props: { size?: number }) {
  const s = props.size ?? 42;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
      <circle cx={s / 2} cy={s / 2} r={s / 2 - 2} stroke="url(#logoGrad)" stroke-width="1.5" opacity="0.3"/>
      <circle cx={s / 2} cy={s / 2} r={s * 0.095} fill={C.primary}/>
      <circle cx={s * 0.238} cy={s * 0.286} r={s * 0.06} fill={C.danger}/>
      <circle cx={s * 0.762} cy={s * 0.286} r={s * 0.06} fill={C.danger}/>
      <circle cx={s * 0.238} cy={s * 0.714} r={s * 0.06} fill={C.primary}/>
      <circle cx={s * 0.762} cy={s * 0.714} r={s * 0.06} fill={C.primary}/>
      <circle cx={s / 2} cy={s * 0.143} r={s * 0.048} fill={C.success}/>
      <circle cx={s / 2} cy={s * 0.857} r={s * 0.048} fill={C.success}/>
      <line x1={s / 2} y1={s / 2} x2={s * 0.238} y2={s * 0.286} stroke={C.danger} stroke-width="1" opacity="0.4"/>
      <line x1={s / 2} y1={s / 2} x2={s * 0.762} y2={s * 0.286} stroke={C.danger} stroke-width="1" opacity="0.4"/>
      <line x1={s / 2} y1={s / 2} x2={s * 0.238} y2={s * 0.714} stroke={C.primary} stroke-width="1" opacity="0.4"/>
      <line x1={s / 2} y1={s / 2} x2={s * 0.762} y2={s * 0.714} stroke={C.primary} stroke-width="1" opacity="0.4"/>
      <line x1={s / 2} y1={s / 2} x2={s / 2} y2={s * 0.143} stroke={C.success} stroke-width="1" opacity="0.3"/>
      <line x1={s / 2} y1={s / 2} x2={s / 2} y2={s * 0.857} stroke={C.success} stroke-width="1" opacity="0.3"/>
      <circle cx={s / 2} cy={s / 2} r={s * 0.143} fill={C.primary} opacity="0.1"/>
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2={s} y2={s}>
          <stop offset="0%" style={{ "stop-color": C.primary }}/>
          <stop offset="100%" style={{ "stop-color": C.success }}/>
        </linearGradient>
      </defs>
    </svg>
  );
}
