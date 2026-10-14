/** Mirrors the API's PasswordPolicy: UTF-16 length and per-char letter/digit categories. */
export function validRegistrationPassword(password: string): boolean {
  if (password.length < 8) return false;
  let letter = false;
  let digit = false;
  let special = false;
  // Java checks char values, so a surrogate pair must not become a single code point here.
  for (let index = 0; index < password.length; index++) {
    const character = password.charAt(index);
    if (/\p{L}/u.test(character)) letter = true;
    else if (/\p{Nd}/u.test(character)) digit = true;
    else special = true;
  }
  return letter && digit && special;
}
