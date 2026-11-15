// Public entry for the shared module. Other modules' application, api and
// infrastructure code imports from here. Domain code imports
// src/shared/domain directly (the one allowed exception).
export { parseId, type Id } from "./domain/id.ts";
export { addMoney, isCurrency, money, sameMoney, CURRENCIES, type Currency, type Money, type MoneyError } from "./domain/money.ts";
export { err, ok, type Err, type Ok, type Result } from "./domain/result.ts";
