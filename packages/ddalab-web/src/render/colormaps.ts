// Heatmap color maps as 256-entry RGBA tables, each entry rounded to sRGB bytes (colormaps.test.ts checks them against
// fixtures/): Crameri's batlow (sequential), vik and berlin (diverging, centered at zero) from cmcrameri 1.10, and
// matplotlib 3.6.3's viridis, plasma and inferno (CC0) and jet, hot and cool sampled at 256 points. The notice below is
// a legal comment the build keeps (scripts/check-dist.mjs checks it); fixtures/CRAMERI-LICENSE.txt is the license as
// cmcrameri ships it.
/*!
 * The batlow, vik and berlin color maps of Crameri's Scientific colour maps.
 * Crameri, F. (2018). Scientific colour maps. Zenodo. doi:10.5281/zenodo.1243862
 *
 * MIT License, Copyright (c) 2020 Fabio Crameri
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
/*!
 * The jet, hot and cool color maps of matplotlib. Copyright (c) 2012- Matplotlib Development Team; All Rights Reserved.
 * License: https://matplotlib.org/stable/project/license.html
 */

/** Every map in the order the picker lists them, with its kind: diverging maps center their limits at zero. */
export const MAPS = [
  { name: "batlow", kind: "Sequential" },
  { name: "viridis", kind: "Sequential" },
  { name: "plasma", kind: "Sequential" },
  { name: "inferno", kind: "Sequential" },
  { name: "hot", kind: "Sequential" },
  { name: "cool", kind: "Sequential" },
  { name: "vik", kind: "Diverging" },
  { name: "berlin", kind: "Diverging" },
  { name: "jet", kind: "Rainbow" },
] as const;

export type MapName = (typeof MAPS)[number]["name"];

/** 256 rows of r, g, b bytes, base64. */
const TABLES: Record<MapName, string> = {
  batlow:
    "ARlZAhtZAxxaBB5aBR9aBiFbByJbByRbCCVbCSdcCihcCipcCytcCy1dDC5dDC9dDTFdDTJeDTNeDjVeDjZeDjdeDzhfDzlfDztfDzxfED1fED5fED9gEEBgEUFgEUJgEUNgEURgEkVhEkZhEkdhEkhhE0lhE0phE0thFExiFE1iFE5iFU9iFU9iFlBiFlFiF1JiF1NiGFRiGFViGVZiGVdiGldiG1hiG1liHFpiHVtiHlxiHl1iH11hIF5hIV9hImBhI2BgJGFgJWJgJmNfJ2NfKGRfKmVeK2VeLGZdLWddL2dcMGhcMWlbM2laNGpaNWpZN2tYOGxYOmxXO21WPG1WPm5VP25UQW9TQm9SRHBSRXBRR3FQSHFPSnJOTHJNTXNNT3NMUHRLUnRKU3VJVXVIV3ZHWHZGWndFW3dFXXhEX3hDYHlCYnlBY3pAZXo/Z3s+aHs+ans9bHw8bXw7b306cX05c344dH44dn83eH82eYA1e4A0fYE0f4EzgYIygoIxhIMxhoMwiIQvioQvjIUujoUuj4YtkYYtk4cslYcsl4gsmYgsm4krnYkrn4kroYoro4ospYssp4ssqYwsq4wtrYwtr40usY0vs44vtY4wt44xuY8yu48zvY80vpA1wJA2wpA3xJE4xpE6yJE7ypI8y5I+zZI/z5NA0ZNC0pND1JRF1pRG2JRI2ZVK25VL3ZVN3pZP4JZR4ZdS45dU5JdW5phY55ha6Zlc6ple65pg7Zpi7ptk75tn8Jxp8Z1r8p1t855w9J9y9Z909qB396F5+KF7+KJ++aOA+aOC+qSF+qWH+6aJ+6aM/KeO/KiQ/KmT/KmV/aqX/aua/ayc/aye/a2g/a6i/a+l/a+n/bCp/bGr/bKt/bKv/bOx/bS0/bS2/bW4/ba6/be8/be+/bjA/bnC/brE/brH/bvJ/bzL/bzN/L3P/L7R/L/T/L/W/MDY/MHa/MLc/MPf/MPh/MTj/MXl+8bo+8bq+8fs+8jv+8nx+8rz+8r2+sv4+sz6",
  vik: "ABJhARRiARVjARdkARhlARpmAhxnAh1oAh9pAiBqAiJrAiNsAiVtAiduAihvAipwAitxAi1yAi5zAjB0AjF1AjN2AjR3AjZ4Ajd5Ajl6Ajp7Azx8Az59Az9+A0F/A0KAA0SBA0WCA0eDA0mEA0qFBEyGBE2HBE+IBVGJBVKKBlSLBlaMB1eNCFmPCVuQC12RDF6SDmCTEGKUEWSWE2aXFWeYF2mZGWuaHG2cHm+dIHGeI3OgJXWhKHeiK3mkLXulMH2mM3+oNoGpOYOrPIWsP4etQomvRYuwSI2yS5CzTpK0UZS2VJa3V5i5Wpq6XZy7YZ69ZKC+Z6LAaqTBbabCcajEdKrFd6zGeq7IfbDJgLLKhLTMh7bNirjOjbrQkLzRlL7Sl8DUmsLVncTWoMXYo8fZp8naqsvcrc3dsM/es9HfttPhutXivdbjwNjkw9rlxtvmyd3nzN/oz+Do0uHp1ePp2OTp2+Xp3ubp4Obp4ufo5efo5+fn6Ofl6ubk6+bi7OXg7eTe7uPc7uHa7uDY7t7V7t3T7tvQ7tnN7dfL7dXI7NPF7NHD69DA6s696cy66cq46Mi158ay5sSw5cGt5L+q5L6o47yl4rqi4big4Lad37Sa37KY3rCV3a6T3KyQ26qN26iL2qaI2aSG2KKD16CB1p9+1p181Zt51Jl305d005Vy0pRw0ZJt0JBrz45oz4xmzotkzYlhzIdfzIVdy4NayoJYyYBWyX5TyHxRx3tPxnlMxndKxXVIxHRFw3JDwnBBwm4/wW08wGs6v2k4vmc2vmUzvWQxvGIvu2Atul4quFwot1omtlgktVUhs1MfslEdsE8br0wYrUoWq0gUqUUSp0MQpUAPoz4NoTwLnzkKnDcJmjUImDMHljEHlC8GkS0GjysGjSkGiycGiSYGhyQGhSIGgyEGgR8Gfx4Gfh0GfBsGehoGeBgGdhcGdBUGcxQGcRMHbxEHbRAHbA4Hag0HaAwHZwoHZQkHYwcHYgYHYAQIXgMIXQIIWwEIWQAI",
  berlin:
    "nrD/nLD+mrD9mK/8la/7k6/6ka75jq73jK72iq71h630ha3zgq3ygKzxfqzwe6zueavtdqvsdKrrcarpb6nobKnmaqjlZ6jjZafiYqbgYKXfXaXdW6TbWKPZVqLXVKDVUZ/TT57RTZ3PS5vNSJrKRpjIRJfGQ5XDQZTBP5K+PpC8PI65O423OYu0OImyN4evNoWtNYSqM4KoMoCmMn6jMXyhMHqeL3icLnaZLXWXLHOULHGSK2+PKm2NKWuLKWmIKGiGJ2aDJ2SBJmJ/JWB8JF56JF14I1t1IllzIldxIVVuIFRsIFJqH1BoHk5lHk1jHUthHElfHEdcG0ZaGkRYGkJWGUFTGT9RGD1PFzxNFzpLFjhJFjdHFTVEFTNCFDJAFDA+Ey88Ey06Eiw4Eio2Eik0EScyESYwESQuESMsESEqESAoEB8mEB0lEBwjERshERogERkeERgcERYbERUZERQYERMXEhIVEhIUExESFBARFA8QFQ4OFg4NFw0LGAwKGQwJGgwIGwsHHAsGHQsFHgsEIAsEIQsDIgwCIwwCJAwCJQwBJg0BJw0BKA0BKg4BKw4BLA4ALQ4ALw4AMA8AMQ8AMw8ANA8ANRAANxAAOBAAOREAOxEAPBEBPhIBPxIBQRIBQhMBRBMBRRQBRxQBSBUCShUCSxYCTRYCTxcDUBgDUhgEVBkFVhoFVxsGWRwHWx0IXR4JXx8KYSALYyEMZSMOaCQPaiUQbCcRbigTcCoUcysWdS0Xdy8ZeTAbezIcfTQegDYggjcihDkkhjsmiD0oij8qjEAsjkIukEQwkkYylEg0lko2mEw5mk07nE89nlE/oFNBolVEpFdGpllIqFpKqlxMrF5PrmBRsGJTsmRVtGZYtmhauGpcumtfvG1hvm9jwHFlwnNoxHVqxndsyHlvyntxzH1zzn920IF40oN61YV914d/2YmC24uE3Y2G34+J4ZGL45OO5ZWQ55eS6pmV7JuX7p2a8J+c8qGf9KOh9qWj+aem+6mo/aur/62t",
  viridis:
    "RAFURAJWRQRXRQVZRgdaRghcRgpdRgteRw1gRw5hRxBjRxFkRxNlSBRnSBZoSBdpSBhqSBpsSBttSBxuSB1vSB9wSCBxSCFzSCN0SCR1SCV2SCZ3SCh4SCl5Ryp6Ryx6Ry17Ry58Ry99RjB+RjJ+RjN/RjSARTWBRTeBRTiCRDmDRDqDRDuEQz2EQz6FQj+FQkCGQkGGQUKHQUSHQEWIQEaIP0eIP0iJPkmJPkqJPkyKPU2KPU6KPE+KPFCLO1GLO1KLOlOLOlSMOVWMOVaMOFiMOFmMN1qMN1uNNlyNNl2NNV6NNV+NNGCNNGGNM2KNM2ONMmSOMmWOMWaOMWeOMWiOMGmOMGqOL2uOL2yOLm2OLm6OLm+OLXCOLXGOLHGOLHKOLHOOK3SOK3WOKnaOKneOKniOKXmOKXqOKXuOKHyOKH2OJ36OJ3+OJ4COJoGOJoKOJoKOJYOOJYSOJYWOJIaOJIeOI4iOI4mOI4qNIouNIoyNIo2NIY6NIY+NIZCNIZGMIJKMIJKMIJOMH5SMH5WLH5aLH5eLH5iLH5mKH5qKHpuKHpyJHp2JH56JH5+IH6CIH6GIH6GHH6KHIKOGIKSGIaWFIaaFIqeFIqiEI6mDJKqDJauCJayCJq2BJ62BKK6AKa9/KrB/LLF+LbJ9LrN8L7R8MbV7MrZ6NLZ5Nbd5N7h4OLl3Orp2O7t1Pbx0P7xzQL1yQr5xRL9wRsBvSMFuSsFtTMJsTsNrUMRqUsVpVMVoVsZnWMdlWshkXMhjXsliYMpgY8tfZcteZ8xcac1bbM1abs5YcM9Xc9BWddBUd9FTetFRfNJQf9NOgdNNhNRLhtVJidVIi9ZGjtZFkNdDk9dBldhAmNg+m9k8ndk7oNo5oto3pds2qNs0qtwyrdwwsN0vst0ttd4ruN4put4ovd8mwN8lwt8jxeAhyOAgyuEfzeEd0OEc0uIb1eIa2OIZ2uMZ3eMY3+MY4uQY5eQZ5+QZ6uUa7OUb7+Uc8eUd9OYe9uYg+OYh++cj/ecl",
  plasma:
    "DQiHEAeIEweJFgeKGQaMGwaNHQaOIAaPIgaQJAaRJgWRKAWSKgWTLAWULgWVLwWWMQWXMwWXNQSYNwSZOASaOgSaPASbPgScPwScQQSdQwOeRAOeRgOfSAOfSQOgSwOhTAKhTgKiUAKiUQKjUwKjVQKkVgGkWAGkWQGlWwGlXAGmXgGmYAGmYQCnYwCnZACnZgCnZwCoaQCoagCobACobgCobwCocQCocgGodAGodQGodwGoeAGoegKoewKofQOofgOogASogQSngwWnhAWnhgamhwemiAimigmliwqljQuljgykjw2kkQ6jkg+jlBCilRGhlhOhmBSgmRWfmhafnBeenRidnhmdoBqcoRuboh2aox6apR+ZpiCYpyGXqCKWqiOVqySUrCaUrSeTriiSsCmRsSqQsiuPsyyOtC6NtS+MtjCLtzGKuDKJujOIuzSIvDWHvTeGvjiFvzmEwDqDwTuCwjyBwz2AxD5/xUB+xkF9x0J8yEN7yUR6ykV6y0Z5zEd4zEl3zUp2zkt1z0x00E1z0U5y0k9x01Fx1FJw1VNv1VRu1lVt11Zs2Fdr2Vhq2lpq2ltp21xo3F1n3V5m3l9l3mFk32Jj4GNj4WRi4mVh4mZg42hf5Gle5Wpd5Wtd5mxc525b529a6HBZ6XFY6XJX6nRX63VW63ZV7HdU7XlT7XpS7ntR73xR735Q8H9P8IBO8YFN8YNM8oRL84VL84dK9IhJ9IlI9YtH9YxG9o1F9o9E95BE95FD95NC+JRB+JVA+Zc/+Zg++Zo++ps9+pw8+p47+586+6E5+6I4/KM4/KU3/KY2/Kg1/Kk0/asz/awz/a4y/a8x/bEw/bIv/bQv/bUu/rct/rgs/ros/rsr/r0q/r4q/sAp/cIp/cMo/cUn/cYn/cgn/com/csm/M0l/M4l/NAl/NIl+9Mk+9Uk+9ck+tgk+tok+dwk+d0l+N8l+OEl9+Il9+Ql9uYm9ugm9ekm9esn9O0n8+4n8/An8vIn8fQm8fUl8Pck8Pkh",
  inferno:
    "AAAEAQAFAQEGAQEIAgEKAgIMAgIOAwIQBAMSBAMUBQQXBgQZBwUbCAUdCQYfCgciCwckDAgmDQgpDgkrEAktEQowEgoyFAs0FQs3Fgs5GAw8GQw+GwxBHAxDHgxFHwxIIQxKIwxMJAxPJgxRKAtTKQtVKwtXLQtZLwpbMQpcMgpeNApfNglhOAliOQljOwlkPQllPglmQApnQgpoRApoRQppRwtqSQtqSgxrTAxrTQ1sTw1sUQ5sUg5tVA9tVQ9tVxBuWRBuWhFuXBJuXRJuXxNuYRNuYhRuZBVuZRVuZxZuaRZuahdubBhubRhubxlucRluchpudBpudRtudxxteBxteh1tfB1tfR5tfx5sgB9sgiBshCBrhSFrhyFriCJqiiJqjCNpjSNpjyRpkCVokiVokyZnlSZnlydmmCdmmihlmylknSlknypjoCpjoitioyxhpSxgpi1gqC5fqS5eqy9erTBdrjBcsDFbsTJaszJatDNZtjRYtzVXuTVWujZVvDdUvThTvzlSwDpRwTpQwztPxDxOxj1Nxz5MyD9LykBKy0FJzEJIzkNHz0RG0EVF0kZE00dD1EhC1UpB10s/2Ew+2U092k4821A73VE63lI431M34FU24VY14lc041kz5Fox5Vww5l0v514u6GAt6WEr6mMq62Qp62Yo7Gcm7Wkl7mok72wj724h8G8g8XEf8XMd8nQc83Yb83gZ9HkY9XsX9X0V9n4U9oAT94IS94QQ+IUP+IcO+IkM+YsL+YwK+Y4J+pAI+pIH+pQH+5YG+5cG+5kG+5sG+50H/J8H/KEI/KMJ/KUK/KYM/KgN/KoP/KwR/K4S/LAU/LIW/LQY+7Ya+7gd+7of+7wh+74j+sAm+sIo+sQq+sYt+ccv+cky+cs1+M03+M8699E999NA9tVD9tdG9dlJ9dtM9N1P9N9T9OFW8+Na8+Vd8uZh8uhl8upp8ext8e1x8e918fF58vJ98vSC8/WG8/aK9PiO9fmS9vqW+Pua+fyd+v2h/P+k",
  jet: "AACAAACEAACJAACNAACSAACWAACbAACfAACkAACoAACtAACxAAC2AAC7AAC/AADEAADIAADNAADRAADWAADaAADfAADjAADoAADtAADxAAD2AAD6AAD/AAD/AAD/AAD/AAD/AAX/AAj/AA3/ABD/ABX/ABj/AB3/ACD/ACT/ACn/ACz/ADH/ADT/ADn/ADz/AEH/AET/AEn/AE3/AFD/AFX/AFj/AF3/AGD/AGX/AGj/AG3/AHD/AHX/AHn/AHz/AIH/AIT/AIn/AIz/AJH/AJT/AJn/AJz/AKD/AKX/AKj/AK3/ALD/ALX/ALj/AL3/AMD/AMX/AMn/AMz/ANH/ANT/ANn/ANz+AOH7AOT4Aun0BuzxCfDuDPXrD/jnE/3kFv/hGf/eHP/bH//XI//UJv/RKf/OLP/KMP/HM//ENv/BOf++PP+6QP+3Q/+0Rv+xSf+tTf+qUP+nU/+kVv+gWv+dXf+aYP+XY/+UZv+Qav+Nbf+KcP+Hc/+Dd/+Aev99ff96gP93g/9zh/9wiv9tjf9qkP9mlP9jl/9gmv9dnf9aoP9WpP9Tp/9Qqv9Nrf9Jsf9GtP9Dt/9Auv88vv85wf82xP8zx/8wyv8szv8p0f8m1P8j1/8f2/8c3v8Z4f8W5P8T5/8P6/8M7v8J8fwG9PgC+PUA+/EA/u0A/+oA/+YA/+IA/94A/9sA/9cA/9MA/9AA/8wA/8gA/8QA/8EA/70A/7kA/7YA/7IA/64A/6sA/6cA/6MA/58A/5wA/5gA/5QA/5EA/40A/4kA/4YA/4IA/34A/3oA/3cA/3MA/28A/2wA/2gA/2QA/2AA/10A/1kA/1UA/1IA/04A/0oA/0cA/0MA/z8A/zsA/zgA/zQA/zAA/y0A/ykA/yUA/yIA/x4A/xoA/xYA/xMA+g8A9gsA8QgA7QQA6AAA4wAA3wAA2gAA1gAA0QAAzQAAyAAAxAAAvwAAuwAAtgAAsQAArQAAqAAApAAAnwAAmwAAlgAAkgAAjQAAiQAAhAAAgAAA",
  hot: "CwAADQAAEAAAEgAAFQAAGAAAGgAAHQAAIAAAIgAAJQAAJwAAKgAALQAALwAAMgAANQAANwAAOgAAPAAAPwAAQgAARAAARwAASgAATAAATwAAUQAAVAAAVwAAWQAAXAAAXwAAYQAAZAAAZgAAaQAAbAAAbgAAcQAAdAAAdgAAeQAAewAAfgAAgQAAgwAAhgAAiQAAiwAAjgAAkAAAkwAAlgAAmAAAmwAAngAAoAAAowAApQAAqAAAqwAArQAAsAAAswAAtQAAuAAAugAAvQAAwAAAwgAAxQAAyAAAygAAzQAAzwAA0gAA1QAA1wAA2gAA3QAA3wAA4gAA5AAA5wAA6gAA7AAA7wAA8gAA9AAA9wAA+QAA/AAA/wAA/wIA/wUA/wgA/woA/w0A/xAA/xIA/xUA/xcA/xoA/x0A/x8A/yIA/yUA/ycA/yoA/ywA/y8A/zIA/zQA/zcA/zoA/zwA/z8A/0EA/0QA/0cA/0kA/0wA/08A/1EA/1QA/1YA/1kA/1wA/14A/2EA/2QA/2YA/2kA/2sA/24A/3EA/3MA/3YA/3kA/3sA/34A/4AA/4MA/4YA/4gA/4sA/44A/5AA/5MA/5UA/5gA/5sA/50A/6AA/6IA/6UA/6gA/6oA/60A/7AA/7IA/7UA/7cA/7oA/70A/78A/8IA/8UA/8cA/8oA/8wA/88A/9IA/9QA/9cA/9oA/9wA/98A/+EA/+QA/+cA/+kA/+wA/+8A//EA//QA//YA//kA//wA//4A//8D//8H//8L//8P//8T//8X//8b//8f//8i//8m//8q//8u//8y//82//86//8+//9C//9G//9K//9O//9S//9W//9a//9e//9h//9l//9p//9t//9x//91//95//99//+B//+F//+J//+N//+R//+V//+Z//+d//+g//+k//+o//+s//+w//+0//+4//+8///A///E///I///M///Q///U///Y///c///f///j///n///r///v///z///3///7////",
  cool: "AP//Af7/Av3/A/z/BPv/Bfr/Bvn/B/j/CPf/Cfb/CvX/C/T/DPP/DfL/DvH/D/D/EO//Ee7/Eu3/E+z/FOv/Fer/Fun/F+j/GOf/Geb/GuX/G+T/HOP/HeL/HuH/H+D/IN//Id7/It3/I9z/JNv/Jdr/Jtn/J9j/KNf/Kdb/KtX/K9T/LNP/LdL/LtH/L9D/MM//Mc7/Ms3/M8z/NMv/Ncr/Nsn/N8j/OMf/Ocb/OsX/O8T/PMP/PcL/PsH/P8D/QL//Qb7/Qr3/Q7z/RLv/Rbr/Rrn/R7j/SLf/Sbb/SrX/S7T/TLP/TbL/TrH/T7D/UK//Ua7/Uq3/U6z/VKv/Var/Vqn/V6j/WKf/Wab/WqX/W6T/XKP/XaL/XqH/X6D/YJ//YZ7/Yp3/Y5z/ZJv/ZZr/Zpn/Z5j/aJf/aZb/apX/a5T/bJP/bZL/bpH/b5D/cI//cY7/co3/c4z/dIv/dYr/don/d4j/eIf/eYb/eoX/e4T/fIP/fYL/foH/f4D/gH//gX7/gn3/g3z/hHv/hXr/hnn/h3j/iHf/iXb/inX/i3T/jHP/jXL/jnH/j3D/kG//kW7/km3/k2z/lGv/lWr/lmn/l2j/mGf/mWb/mmX/m2T/nGP/nWL/nmH/n2D/oF//oV7/ol3/o1z/pFv/pVr/pln/p1j/qFf/qVb/qlX/q1T/rFP/rVL/rlH/r1D/sE//sU7/sk3/s0z/tEv/tUr/tkn/t0j/uEf/uUb/ukX/u0T/vEP/vUL/vkH/v0D/wD//wT7/wj3/wzz/xDv/xTr/xjn/xzj/yDf/yTb/yjX/yzT/zDP/zTL/zjH/zzD/0C//0S7/0i3/0yz/1Cv/1Sr/1in/1yj/2Cf/2Sb/2iX/2yT/3CP/3SL/3iH/3yD/4B//4R7/4h3/4xz/5Bv/5Rr/5hn/5xj/6Bf/6Rb/6hX/6xT/7BP/7RL/7hH/7xD/8A//8Q7/8g3/8wz/9Av/9Qr/9gn/9wj/+Af/+Qb/+gX/+wT//AP//QL//gH//wD/",
};

function table(base64: string): Uint8Array {
  const rgb = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    lut.set(rgb.subarray(3 * i, 3 * i + 3), 4 * i);
    lut[4 * i + 3] = 255;
  }
  return lut;
}

export const LUTS = Object.fromEntries(MAPS.map(({ name }) => [name, table(TABLES[name])])) as Record<
  MapName,
  Uint8Array
>;

/**
 * The map of an array by its kind. Q of ST and CT is the a1 coefficient, of CD a gain in RMSE and of SY a difference
 * of RMSE ratios: signed, with zero meaning none (diverging: vik, or berlin in the dark theme, whose dark middle keeps
 * the heatmap from being the brightest part of a dark page). Q of DE is an absolute value and a fit error an RMSE:
 * sequential (batlow) in both themes. A map the user `picked` replaces that choice for every array (one stored by an older version and since
 * removed does not).
 */
const SIGNED = new Set(["ST/q", "CT/q", "CD/q", "SY/q"]);
export const mapOf = (
  variant: string,
  array: "q" | "fit_error",
  dark = false,
  picked: MapName | null = null,
): MapName =>
  picked && picked in LUTS
    ? picked
    : SIGNED.has(`${variant}/${array}`)
      ? dark
        ? "berlin"
        : "vik"
      : "batlow";

const DIVERGING = new Set<MapName>(MAPS.filter((m) => m.kind === "Diverging").map((m) => m.name));

/**
 * The limits of a map over finite values from `min` to `max`: a diverging map symmetric about zero, any other from
 * `min` to `max`. Without a finite value (`min > max`) or without a spread, the limits widen by one.
 */
export function scaleOf(map: MapName, min: number, max: number): { lo: number; hi: number } {
  if (!(min <= max)) return { lo: -1, hi: 1 };
  if (DIVERGING.has(map)) {
    const m = Math.max(Math.abs(min), Math.abs(max));
    return m > 0 ? { lo: -m, hi: m } : { lo: -1, hi: 1 };
  }
  return max > min ? { lo: min, hi: max } : { lo: min - 1, hi: max + 1 };
}

/** The entry `value` draws as between the limits, as the heatmap shader picks it. */
export const colorIndex = (value: number, lo: number, hi: number) =>
  Math.floor(Math.min(1, Math.max(0, (value - lo) / (hi - lo))) * 255 + 0.5);

/** The map as a CSS gradient from left to right, for the color bar. */
export function gradient(map: MapName): string {
  const lut = LUTS[map];
  const stops = Array.from({ length: 17 }, (_, s) => {
    const i = Math.round((s / 16) * 255);
    return `rgb(${lut[4 * i]} ${lut[4 * i + 1]} ${lut[4 * i + 2]}) ${(s / 16) * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
