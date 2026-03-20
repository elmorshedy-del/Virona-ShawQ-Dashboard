from __future__ import annotations

LETTER_SIFAAT = {
    "ء": ["jahr", "shiddah", "istifaal", "infitaah", "ismaat"],
    "ب": ["jahr", "shiddah", "istifaal", "infitaah", "idhlaq", "qalqalah"],
    "ت": ["hams", "shiddah", "istifaal", "infitaah", "idhlaq"],
    "ث": ["hams", "rakhawah", "istifaal", "infitaah", "ismaat"],
    "ج": ["jahr", "shiddah", "istifaal", "infitaah", "ismaat", "qalqalah"],
    "ح": ["hams", "rakhawah", "istifaal", "infitaah", "ismaat"],
    "خ": ["hams", "rakhawah", "istilaa", "infitaah", "ismaat"],
    "د": ["jahr", "shiddah", "istifaal", "infitaah", "idhlaq", "qalqalah"],
    "ذ": ["jahr", "rakhawah", "istifaal", "infitaah", "ismaat"],
    "ر": ["jahr", "tawassut", "istifaal", "infitaah", "idhlaq", "inhiraf", "takreer"],
    "ز": ["jahr", "rakhawah", "istifaal", "infitaah", "ismaat", "safeer"],
    "س": ["hams", "rakhawah", "istifaal", "infitaah", "ismaat", "safeer"],
    "ش": ["hams", "rakhawah", "istifaal", "infitaah", "ismaat", "tafashshi"],
    "ص": ["hams", "rakhawah", "istilaa", "itbaaq", "ismaat", "safeer"],
    "ض": ["jahr", "rakhawah", "istilaa", "itbaaq", "ismaat", "istitaalah"],
    "ط": ["jahr", "shiddah", "istilaa", "itbaaq", "ismaat", "qalqalah"],
    "ظ": ["jahr", "rakhawah", "istilaa", "itbaaq", "ismaat"],
    "ع": ["jahr", "tawassut", "istifaal", "infitaah", "ismaat"],
    "غ": ["jahr", "rakhawah", "istilaa", "infitaah", "ismaat"],
    "ف": ["hams", "rakhawah", "istifaal", "infitaah", "idhlaq"],
    "ق": ["jahr", "shiddah", "istilaa", "infitaah", "ismaat", "qalqalah"],
    "ك": ["hams", "shiddah", "istifaal", "infitaah", "ismaat"],
    "ل": ["jahr", "tawassut", "istifaal", "infitaah", "idhlaq", "inhiraf"],
    "م": ["jahr", "tawassut", "istifaal", "infitaah", "idhlaq"],
    "ن": ["jahr", "tawassut", "istifaal", "infitaah", "idhlaq"],
    "ه": ["hams", "rakhawah", "istifaal", "infitaah", "ismaat"],
    "و": ["jahr", "rakhawah", "istifaal", "infitaah", "ismaat", "leen"],
    "ي": ["jahr", "rakhawah", "istifaal", "infitaah", "ismaat", "leen"],
}

SIFAH_TO_DETECTION = {
    "hams": {
        "method": "dsp",
        "measure": "breath_energy_ratio",
        "description": "Measure breath energy - hams letters allow airflow through",
        "check": "High-frequency noise energy should be present during consonant",
    },
    "jahr": {
        "method": "dsp",
        "measure": "voicing_energy",
        "description": "Measure vocal fold vibration - jahr letters trap the breath",
        "check": "Low-frequency periodic energy should dominate, breath noise absent",
    },
    "shiddah": {
        "method": "dsp",
        "measure": "energy_stop",
        "description": "Sound stops completely at makhraj - sharp energy cutoff",
        "check": "Energy should drop to near zero at articulation point",
    },
    "rakhawah": {
        "method": "dsp",
        "measure": "energy_continuity",
        "description": "Sound flows continuously - no abrupt energy stop",
        "check": "Energy should flow smoothly through the consonant",
    },
    "tawassut": {
        "method": "dsp",
        "measure": "partial_energy_flow",
        "description": "Between shiddah and rakhawah - sound partially flows",
        "check": "Letters ل ن ع م ر - sound partially continues, partially stops",
    },
    "istilaa": {
        "method": "dsp",
        "measure": "f2_depression",
        "description": "Tongue root retraction - F2 drops below ~1200Hz",
        "check": "This IS tafkheem. F2 should be depressed compared to plain letters",
    },
    "istifaal": {
        "method": "dsp",
        "measure": "f2_elevation",
        "description": "Tongue stays low - F2 remains high (~1400Hz+)",
        "check": "This IS tarqeeq. F2 should not be depressed",
    },
    "itbaaq": {
        "method": "dsp",
        "measure": "f2_f3_pattern",
        "description": "Tongue adheres to palate - affects both F2 and F3",
        "check": "Only ص ض ط ظ - strongest tafkheem, F2 and F3 both shift",
    },
    "infitaah": {
        "method": "dsp",
        "measure": "normal_formants",
        "description": "Open articulation - no special formant effects",
        "check": "Default state, no special check needed",
    },
    "qalqalah": {
        "method": "dsp",
        "measure": "post_release_burst",
        "description": "Echo/bounce after stop release on ق ط ب ج د with sukoon",
        "check": "Brief energy burst (5-25ms) after consonant release",
    },
    "safeer": {
        "method": "dsp",
        "measure": "sibilant_energy",
        "description": "High-frequency whistling on ص ز س",
        "check": "Energy peak in 4000-8000Hz band during consonant",
    },
    "inhiraf": {
        "method": "ml",
        "measure": "lateral_trill_pattern",
        "description": "Sound deflects to tongue sides (ل) or tip vibrates (ر)",
        "check": "ML classifier for lateral vs trill vs neither",
    },
    "tafashshi": {
        "method": "dsp",
        "measure": "wideband_noise",
        "description": "ش spreads across a wide frequency band",
        "check": "Broad-spectrum fricative noise, no spectral peak",
    },
    "istitaalah": {
        "method": "ml",
        "measure": "lateral_contact_duration",
        "description": "ض has elongated lateral tongue contact - unique letter",
        "check": "ML classifier - ض is the hardest Arabic letter to verify",
    },
    "leen": {
        "method": "dsp",
        "measure": "smooth_transition",
        "description": "و ي with sukoon after fatha - gentle glide",
        "check": "Gradual formant transition, no abrupt change",
    },
    "takreer": {
        "method": "dsp",
        "measure": "amplitude_modulation",
        "description": "ر has natural vibration tendency - must not overdo it",
        "check": "Detect rapid amplitude modulation (trill). One tap is correct, multiple taps is error",
    },
}


def get_checks_for_letter(letter: str) -> list[dict]:
    sifaat = LETTER_SIFAAT.get(letter, [])
    checks = []
    for sifah in sifaat:
        detection = SIFAH_TO_DETECTION.get(sifah)
        if detection:
            checks.append({"sifah": sifah, "letter": letter, **detection})
    return checks


def get_distinguishing_checks(letter_a: str, letter_b: str) -> list[dict]:
    sifaat_a = set(LETTER_SIFAAT.get(letter_a, []))
    sifaat_b = set(LETTER_SIFAAT.get(letter_b, []))
    only_a = sifaat_a - sifaat_b
    only_b = sifaat_b - sifaat_a

    checks = []
    for sifah in only_a | only_b:
        detection = SIFAH_TO_DETECTION.get(sifah)
        if not detection:
            continue
        belongs_to = letter_a if sifah in only_a else letter_b
        absent_from = letter_b if sifah in only_a else letter_a
        checks.append(
            {
                "sifah": sifah,
                "belongs_to": belongs_to,
                "absent_from": absent_from,
                **detection,
            }
        )
    return checks
