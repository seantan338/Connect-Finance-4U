// 固定 demo 标识,供 seed 与 dev API 共享(保证幂等 + 不漂移)。
// 真实多租户上线后,org/user 由 Firebase Auth + onboarding 决定,不再用这些常量。
export const DEMO_ORG_ID = '00000000-0000-0000-0000-0000000000a1';
export const DEMO_USER_ID = '00000000-0000-0000-0000-0000000000b1';
