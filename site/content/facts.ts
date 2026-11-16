export const F = {
  bands: '102',
  lamRange: '0.75–5.0 µm',
  pixel: '6.15″',

  perExposure: '80 kB',
  fileSize: '65.8 MB',
  cutoutCost: '3.95 MB',
  cutoutTable: '3.86 MB',
  fieldExposures: '358',
  fieldCost: '29 MB',
  fieldCostOfficial: '1.4 GB',
  liveExposures: '450',
  liveEstimate: '35.5 MB',
  liveMeasured: '36.4 MB',
  repeatability: '0.1–0.2″',

  w0855Shift: '129.5 ± 0.3″',
  w0855ShiftCatalogue: '128.6″',
  w0855Pm: '−8.125 ± 0.009, +0.686 ± 0.012',
  w0855PmPublished: '−8.118, +0.680',
  w0855Plx: '0.50',
  w0855PlxStat: '0.04',
  w0855PlxSys: '0.09',
  w0855PlxPublished: '0.439″',
  w0855Dist: '2.0 pc',
  w0855DistPublished: '2.28 pc',
  w0855Flux: '+514 ± 21 µJy',
  w0855Controls: '150',
  wiseEpochs: '23',
  spherexEpochs: '3',
  baselineYears: '16',

  luhmanShift: '(−2.86″, +0.31″)',
  luhmanModel: '(−2.73″, +0.31″)',
  luhmanRatio: '12–17',

  epsShift: '(+5.0″, −3.8″)',
  epsModel: '(+5.1″, −3.8″)',
  epsPlx: '0.276 ± 0.134″',
  epsPlxPublished: '0.275″',

  smdetNoiseRaw: '333',
  smdetNoiseColour: '75',
  smdetBlanks: '25 / 300',
  smdetChance: '8.6%',

  rdraPeriod: '250–280',
  rdraFormal: '267 ± 5',
  rdraPublished: '245.6',
  rdraAmplitude: '1.7',
  rdraCycles: '1.95',
  rwaurBrightening: '0.22',
  rwaurControl: '−0.01',

  barnardAgree: '0.3″',
  barnardShift: '10.2″',
  barnardModel: '10.3″',
  barnardOffset: '1.1″',

  blindFound: '37 / 42',
  blindBright: '17 / 17',
  blindBlank: '4.0%',
  blindFalse: '4.8',
  blindFalseTotal: '202',

  injected: '275.85 µJy',
  injectedRecovered: '40 / 40',
  machineLarge: '19 / 19',
  machineSmall: '1 / 30',
  limit: '275 µJy',
  parity: '68 / 68',

  fusionLimit: '12″',

  planetXShift: '13.8–16.0′',
} as const;

export const MACHINE_TABLE = {
  shifts: [3, 6, 12],
  rows: [
    { snr: 6, cells: ['0 / 10', '0 / 10', '1 / 9'] },
    { snr: 10, cells: ['0 / 10', '1 / 9', '9 / 9'] },
    { snr: 16, cells: ['1 / 10', '9 / 10', '10 / 10'] },
  ],
} as const;
