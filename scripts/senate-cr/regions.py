"""One label per region across the four programs (the DPWH data's: "Region I", "Region IV-A", "MIMAROPA", "CAR").

The sources spell regions many ways: "REGION I - ILOCOS" and "Region I - ILOCOS" (FMR, House vs NEP-only rows),
"REGION 1" / "REGION 4A" / "REGION IV-A" (NIA annex), "Cordillera Administrative Region (CAR)" / "CALABARZON"
(HFEP). Left as they are, one region shows as several rows, some of them all zeros.
"""
import re

ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII"]
NAMED = [  # (pattern on the upper-cased label, canonical label)
    (r"CORDILLERA|^CAR\b", "CAR"),
    (r"NATIONAL CAPITAL|^NCR\b", "NCR"),
    (r"NEGROS ISLAND|^NIR\b", "NIR"),
    (r"BANGSAMORO|^BARMM\b|^ARMM\b", "BARMM"),
    (r"CALABARZON", "Region IV-A"),
    (r"MIMAROPA", "MIMAROPA"),
    (r"NATIONWIDE", "Nationwide"),
    # NIA's two integrated systems the annex prints as regions of their own: Magat (Isabela) and Upper Pampanga
    # (Nueva Ecija).
    (r"^MARIIS\b", "Region II"),
    (r"^UPRIIS\b", "Region III"),
]


def canon_region(s):
    if not s or not s.strip():
        return None
    u = s.strip().upper()
    for pat, lab in NAMED:
        if re.search(pat, u):
            return lab
    m = re.match(r"^REGION\s+([IVX]+|\d+)\s*-?\s*([AB])?\b", u)
    if not m:
        return s.strip()
    num, letter = m.groups()
    roman = ROMAN[int(num) - 1] if num.isdigit() else num
    if roman == "IV" and letter == "B":
        return "MIMAROPA"
    return f"Region {roman}" + (f"-{letter}" if letter else "")
