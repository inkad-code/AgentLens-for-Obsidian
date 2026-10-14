/*! @license Lucide icon assets v0.576.0
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2026 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2026.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The MIT License (MIT) (for portions derived from Feather)

Copyright (c) 2013-2026 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
import { createElement } from "react";

const iconNodes = {
  "check": [["path", { d: "m9 12 2 2 4-4", key: "check" }]],
  "refresh-cw": [
    ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", key: "refresh-top" }],
    ["path", { d: "M21 3v5h-5", key: "refresh-right" }],
    ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", key: "refresh-bottom" }],
    ["path", { d: "M8 16H3v5", key: "refresh-left" }]
  ],
  "eye": [
    [
      "path",
      {
        "d": "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
        "key": "1nclc0"
      }
    ],
    [
      "circle",
      {
        "cx": "12",
        "cy": "12",
        "r": "3",
        "key": "1v7zrd"
      }
    ]
  ],
  "eye-off": [
    [
      "path",
      {
        "d": "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
        "key": "ct8e1f"
      }
    ],
    [
      "path",
      {
        "d": "M14.084 14.158a3 3 0 0 1-4.242-4.242",
        "key": "151rxh"
      }
    ],
    [
      "path",
      {
        "d": "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
        "key": "13bj9a"
      }
    ],
    [
      "path",
      {
        "d": "m2 2 20 20",
        "key": "1ooewy"
      }
    ]
  ],
  "image-off": [
    [
      "line",
      {
        "x1": "2",
        "x2": "22",
        "y1": "2",
        "y2": "22",
        "key": "a6p6uj"
      }
    ],
    [
      "path",
      {
        "d": "M10.41 10.41a2 2 0 1 1-2.83-2.83",
        "key": "1bzlo9"
      }
    ],
    [
      "line",
      {
        "x1": "13.5",
        "x2": "6",
        "y1": "13.5",
        "y2": "21",
        "key": "1q0aeu"
      }
    ],
    [
      "line",
      {
        "x1": "18",
        "x2": "21",
        "y1": "12",
        "y2": "15",
        "key": "5mozeu"
      }
    ],
    [
      "path",
      {
        "d": "M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59",
        "key": "mmje98"
      }
    ],
    [
      "path",
      {
        "d": "M21 15V5a2 2 0 0 0-2-2H9",
        "key": "43el77"
      }
    ]
  ],
  "file-text": [
    [
      "path",
      {
        "d": "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
        "key": "1oefj6"
      }
    ],
    [
      "path",
      {
        "d": "M14 2v5a1 1 0 0 0 1 1h5",
        "key": "wfsgrz"
      }
    ],
    [
      "path",
      {
        "d": "M10 9H8",
        "key": "b1mrlr"
      }
    ],
    [
      "path",
      {
        "d": "M16 13H8",
        "key": "t4e002"
      }
    ],
    [
      "path",
      {
        "d": "M16 17H8",
        "key": "z1uh3a"
      }
    ]
  ]
} as const;

/** Local Lucide assets approved for feedback 3 and 11; no runtime package dependency. */
export function FeedbackIcon({ name, className, strokeWidth = 1.6 }: { name: keyof typeof iconNodes; className?: string; strokeWidth?: number }) {
  return createElement("svg", { xmlns: "http://www.w3.org/2000/svg", width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": true },
    iconNodes[name].map(([tag, attributes]) => createElement(tag, attributes)));
}
