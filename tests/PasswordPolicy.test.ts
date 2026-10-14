import { describe, expect, it } from "vitest";
import { validRegistrationPassword } from "../src/auth/PasswordPolicy";

describe("registration password contract", () => {
  it.each(["abcdefgh", "12345678", "!!!!!!!!", "abc12345", "abcdefgh!", "1234567!", "Aa1!", "𐐀12345!"])("rejects missing categories or insufficient UTF-16 length: %s", password => {
    expect(validRegistrationPassword(password)).toBe(false);
  });
  it.each(["example1!", "中文密码测试１２!", "password1 ", "a12345😀"])("accepts the API's Unicode letters, decimal digits and special characters: %s", password => {
    expect(validRegistrationPassword(password)).toBe(true);
  });
});
