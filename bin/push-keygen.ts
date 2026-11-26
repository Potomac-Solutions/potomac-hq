// Makes the VAPID key pair phone alerts are signed with (quality of life,
// 2026-11-25). Put both in the server's settings; keep the private one secret.
//   npm run push:keygen
import { vapidKeyPair } from "../src/push/adapters.ts";

const pair = vapidKeyPair();
console.log("Set these on the server (Railway → Variables), then restart HQ:\n");
console.log(`HQ_VAPID_PUBLIC_KEY=${pair.publicKey}`);
console.log(`HQ_VAPID_PRIVATE_KEY=${pair.privateKey}`);
console.log("HQ_VAPID_SUBJECT=mailto:mikey@potomac.solutions\n");
console.log("The private key signs every alert HQ sends. Keep it out of the repository.");
