from __future__ import annotations

TARGETS = {
    "wise0855": {
        "name": "WISE 0855−0714",
        "kind": "Y dwarf, 2.28 pc",
        "center": (133.7776, -7.2437),
        "astrometry": {
            "ra": 133.795125, "dec": -7.245139, "epoch": 2010.5,
            "pmra": -8.118, "pmdec": 0.680, "plx": 0.439},
        "challenge_coord": (133.795129, -7.245147),
        "default_band": "W2s",
    },
    "barnard": {
        "name": "Barnard's Star",
        "kind": "M4 dwarf, 1.83 pc",
        "center": (269.4462, 4.7687),
        "astrometry": {
            "ra": 269.448503, "dec": 4.739420, "epoch": 2016.0,
            "pmra": -0.80155, "pmdec": 10.36239, "plx": 0.54698},
        "default_band": "W2s",
    },
    "epsindib": {
        "name": "ε Indi Ba/Bb",
        "kind": "T1 + T6 brown dwarf pair, 3.64 pc",
        "center": (331.0961, -56.8010),
        "astrometry": {
            "ra": 331.04383, "dec": -56.78269, "epoch": 2000.0,
            "pmra": 3.966, "pmdec": -2.536, "plx": 0.2748},
        "default_band": "D2",
    },
    "luhman16": {
        "name": "Luhman 16 AB",
        "kind": "L7.5 + T0.5 brown dwarf pair, 2.0 pc",
        "center": (162.3288, -53.3194),
        "astrometry": {
            "ra": 162.314875, "dec": -53.318361, "epoch": 2010.4,
            "pmra": -2.759, "pmdec": 0.358, "plx": 0.496},
        "default_band": "D3",
    },
    "rwaur": {
        "name": "RW Aurigae",
        "kind": "T Tauri variable",
        "center": (76.9563, 30.4014),
        "astrometry": None,
        "default_band": "D3",
    },
    "rdra": {
        "name": "R Draconis",
        "kind": "Mira variable, P ≈ 245.6 d",
        "center": (248.1675, 66.7550),
        "astrometry": None,
        "period": 245.6,
        "default_band": "D3",
    },
    "smdet1": {
        "name": "SMDET-1",
        "kind": "Y dwarf candidate, b = +2.25° (Meisner et al. 2026)",
        "center": (295.7967, 28.1356),
        "astrometry": {
            "ra": 295.791939, "dec": 28.132809, "epoch": 2012.115,
            "pmra": 1.0595, "pmdec": 0.7143, "plx": 0.0},
        "default_band": "W2s",
    },
}
