// Coordinates for Iran-war timeline events (see task-3-brief.md). Keyed by
// `date` + a title prefix — the production dataset has duplicate dates, so
// date alone isn't unique. Matching (see src/layers/warEvents/source.js):
// normDate(row.date) === entry.date && normTitle(row.title).startsWith(normTitle(entry.title))
// Rows with no matching entry are skipped silently (counted as `unplaced`).
// Entries whose row has vanished from the live dataset are ignored.
//
// [lat, lon]; c: H (named place, reliable) | A (approximate/centroid) |
// U (uncertain — text only names a region/sea; render hollow).
// kind: us-strike | israel-strike | iran-attack (incl. Hezbollah/Houthi) |
// maritime | diplomacy | loss | unattributed. A place may carry its own
// `kind` when one row pins both sides' actions. Re-tagged 2026-09-26 against
// each row's description: Israeli strikes, toll reports and a UN report were
// tagged us-strike.
export const IRAN_WAR_EVENT_PLACES = Object.freeze([
  {
    date: 'Feb 28, 2026',
    title: 'Khamenei killed in opening strikes',
    kind: 'us-strike',
    places: [{ name: 'Tehran', at: [35.689, 51.389], c: 'H' }],
  },
  {
    date: 'Mar 1, 2026',
    title: 'First US KIA',
    kind: 'loss',
    places: [{ name: 'Near Tabriz', at: [38.08, 46.292], c: 'A' }],
  },
  {
    date: 'Mar 4, 2026',
    title: 'Arleigh Burke destroyer struck',
    kind: 'loss',
    places: [
      {
        name: 'Persian Gulf (position not reported)',
        at: [27.0, 51.5],
        c: 'U',
      },
    ],
  },
  {
    date: 'Mar 9, 2026',
    title: 'IRIN frigate Jamaran hit',
    kind: 'maritime',
    places: [{ name: 'Strait of Hormuz', at: [26.57, 56.25], c: 'A' }],
  },
  {
    date: 'Mar 21, 2026',
    title: 'Dimona retaliation',
    kind: 'iran-attack',
    places: [
      {
        name: 'Dimona (Negev Nuclear Research Center)',
        at: [31.001, 35.146],
        c: 'H',
      },
    ],
  },
  {
    date: 'Mar 26, 2026',
    title: 'IRGC Navy cmdr Tangsiri killed',
    kind: 'israel-strike',
    places: [{ name: 'Bandar Abbas', at: [27.183, 56.267], c: 'H' }],
  },
  {
    date: 'Mar 12, 2026',
    title: 'KC-135 tanker crashes in western Iraq',
    kind: 'loss',
    places: [{ name: 'Western Iraq', at: [33.4, 41.8], c: 'U' }],
  },
  {
    date: 'Apr 7, 2026',
    title: 'E-3 Sentry shot down',
    kind: 'loss',
    places: [{ name: 'Eastern Mediterranean', at: [34.0, 33.0], c: 'U' }],
  },
  {
    date: 'Apr 8, 2026',
    title: 'Ceasefire',
    kind: 'diplomacy',
    places: [{ name: 'Islamabad (broker)', at: [33.684, 73.048], c: 'H' }],
  },
  {
    date: 'Apr 19, 2026',
    title: 'Hormuz restrictions return',
    kind: 'maritime',
    places: [{ name: 'Strait of Hormuz', at: [26.57, 56.25], c: 'A' }],
  },
  {
    date: 'May 4, 2026',
    title: 'Iran strikes UAE Fujairah port',
    kind: 'iran-attack',
    places: [{ name: 'Fujairah port', at: [25.17, 56.36], c: 'A' }],
  },
  {
    date: 'May 4, 2026',
    title: 'US sinks IRGC vessels',
    kind: 'maritime',
    places: [
      { name: 'Strait of Hormuz', at: [26.45, 56.35], c: 'A' },
      { name: 'Khasab (claimed civilian boats)', at: [26.18, 56.248], c: 'A' },
    ],
  },
  {
    date: 'May 6, 2026',
    title: 'Israel assassinates Hezbollah Radwan',
    kind: 'israel-strike',
    places: [{ name: 'Haret Hreik, Beirut', at: [33.851, 35.508], c: 'A' }],
  },
  {
    date: 'May 11, 2026',
    title: 'Hezbollah drone kills IDF reservist',
    kind: 'iran-attack',
    places: [{ name: 'Israel–Lebanon border', at: [33.1, 35.5], c: 'U' }],
  },
  {
    date: 'May 18, 2026',
    title: 'Lebanon toll passes 3,000',
    kind: 'israel-strike',
    places: [{ name: 'Baalbek district', at: [34.006, 36.211], c: 'A' }],
  },
  {
    date: 'May 25, 2026',
    title: 'US self defence strikes on Iran',
    kind: 'us-strike',
    places: [{ name: 'Qeshm Island', at: [26.8, 55.95], c: 'A' }],
  },
  {
    date: 'Jun 2, 2026',
    title: 'IDF soldier killed in Hezbollah drone attack',
    kind: 'iran-attack',
    places: [{ name: 'Beaufort Castle', at: [33.325, 35.531], c: 'H' }],
  },
  {
    date: 'Jun 3, 2026',
    title: 'Iran strikes Kuwait airport',
    kind: 'iran-attack',
    places: [
      { name: 'Kuwait International Airport', at: [29.241, 47.969], c: 'H' },
      {
        name: 'Qeshm Island (US strike)',
        at: [26.8, 55.95],
        c: 'A',
        kind: 'us-strike',
      },
    ],
  },
  {
    date: 'Jun 4, 2026',
    title: 'Lebanese MoH toll reaches 3,516',
    kind: 'israel-strike',
    places: [
      { name: 'Nabatieh', at: [33.378, 35.484], c: 'H' },
      { name: 'Sidon', at: [33.563, 35.369], c: 'H' },
      { name: 'Tyre', at: [33.273, 35.194], c: 'H' },
    ],
  },
  {
    date: 'Jun 6, 2026',
    title: 'Two IDF soldiers killed',
    kind: 'loss',
    places: [{ name: 'Southern Lebanon', at: [33.25, 35.4], c: 'U' }],
  },
  {
    date: 'Jun 9, 2026',
    title: 'AH-64 Apache downed near Hormuz',
    kind: 'loss',
    places: [{ name: 'Near Strait of Hormuz', at: [26.5, 56.3], c: 'U' }],
  },
  {
    date: 'Jun 10, 2026',
    title: 'Iran strikes US bases in Bahrain',
    kind: 'iran-attack',
    places: [
      { name: 'NSA Bahrain / US Fifth Fleet', at: [26.205, 50.61], c: 'A' },
      { name: 'Ali Al Salem AB, Kuwait', at: [29.347, 47.521], c: 'H' },
      {
        name: 'Muwaffaq Salti AB (Azraq), Jordan',
        at: [31.827, 36.782],
        c: 'H',
      },
    ],
  },
  {
    date: 'Jun 11, 2026',
    title: 'Iran closes Strait of Hormuz',
    kind: 'maritime',
    places: [{ name: 'Strait of Hormuz', at: [26.57, 56.25], c: 'A' }],
  },
  {
    date: 'Jun 12, 2026',
    title: 'Pakistan PM declares',
    kind: 'diplomacy',
    places: [{ name: 'Islamabad', at: [33.684, 73.048], c: 'H' }],
  },
  {
    date: 'Jun 14, 2026',
    title: 'Trump says deal to be signed Sunday in Geneva',
    kind: 'diplomacy',
    places: [{ name: 'Geneva', at: [46.204, 6.143], c: 'H' }],
  },
  {
    date: 'Jun 14-15, 2026',
    title: 'Trump declares deal now complete',
    kind: 'israel-strike',
    places: [{ name: 'Ghobeiri, Beirut', at: [33.866, 35.5], c: 'A' }],
  },
  {
    date: 'Jun 17, 2026',
    title: 'Bürgenstock formal signing confirmed',
    kind: 'diplomacy',
    places: [{ name: 'Bürgenstock, Switzerland', at: [46.994, 8.38], c: 'A' }],
  },
  {
    date: 'Jun 17-18, 2026',
    title: 'Trump signs MOU hard copy at Versailles',
    kind: 'diplomacy',
    places: [
      { name: 'Versailles', at: [48.805, 2.12], c: 'H' },
      { name: 'Nabatieh', at: [33.378, 35.484], c: 'H', kind: 'israel-strike' },
    ],
  },
  {
    date: 'Jun 19, 2026',
    title: 'Bürgenstock formal ceremony postponed',
    kind: 'diplomacy',
    places: [{ name: 'Bürgenstock, Switzerland', at: [46.994, 8.38], c: 'A' }],
  },
  {
    date: 'Jun 19-20, 2026',
    title: 'Bürgenstock talks formally canceled',
    kind: 'loss',
    places: [{ name: 'Nabatieh', at: [33.378, 35.484], c: 'H' }],
  },
  {
    date: 'Jun 20-21, 2026',
    title: 'Iran re-closes Hormuz',
    kind: 'maritime',
    places: [{ name: 'Strait of Hormuz', at: [26.57, 56.25], c: 'A' }],
  },
  {
    date: 'Jun 21-22, 2026',
    title: 'Bürgenstock talks proceed',
    kind: 'diplomacy',
    places: [{ name: 'Bürgenstock, Switzerland', at: [46.994, 8.38], c: 'A' }],
  },
  {
    date: 'Jun 25-26, 2026',
    title: 'Lebanese MoH 4,230 killed',
    kind: 'maritime',
    places: [
      { name: 'MV Ever Lovely, Strait of Hormuz', at: [26.55, 56.4], c: 'U' },
    ],
  },
  {
    date: 'Jun 26-27, 2026',
    title: 'US CENTCOM strikes Iran (Qeshm/Hormuz)',
    kind: 'us-strike',
    places: [{ name: 'Qeshm Island', at: [26.8, 55.95], c: 'A' }],
  },
  {
    date: 'Jun 28, 2026',
    title: 'IRGC drone strikes M/T Kiku',
    kind: 'maritime',
    places: [
      { name: 'M/T Kiku, approach to Fujairah', at: [25.3, 56.7], c: 'U' },
      {
        name: 'CENTCOM strikes near Hormuz',
        at: [26.95, 56.1],
        c: 'U',
        kind: 'us-strike',
      },
    ],
  },
  {
    date: 'Jun 29, 2026',
    title: 'Trump admin stand down for now',
    kind: 'iran-attack',
    places: [
      {
        name: 'Ali Al Salem AB, Kuwait (IRGC claim)',
        at: [29.347, 47.521],
        c: 'H',
      },
      {
        name: 'Mina Salman, Bahrain (IRGC claim)',
        at: [26.205, 50.61],
        c: 'A',
      },
    ],
  },
  {
    date: 'Jun 30, 2026',
    title: 'Doha talks',
    kind: 'diplomacy',
    places: [{ name: 'Doha', at: [25.286, 51.533], c: 'H' }],
  },
  {
    date: 'Jul 1, 2026',
    title: 'Qatar PM meets Witkoff and Kushner in Doha',
    kind: 'diplomacy',
    places: [{ name: 'Doha', at: [25.286, 51.533], c: 'H' }],
  },
  {
    date: 'Jul 2, 2026',
    title: 'Doha talks conclude',
    kind: 'diplomacy',
    places: [{ name: 'Doha', at: [25.286, 51.533], c: 'H' }],
  },
  {
    date: 'Jul 3, 2026',
    title: 'MH-60S Seahawk aircrewman',
    kind: 'loss',
    places: [{ name: 'Arabian Sea (ditching)', at: [21.0, 62.0], c: 'U' }],
  },
  {
    date: 'Jul 3-4, 2026',
    title: 'Khamenei s public funeral opens in Tehran',
    kind: 'diplomacy',
    places: [
      { name: 'Imam Khomeini Mosalla, Tehran', at: [35.729, 51.428], c: 'A' },
    ],
  },
  {
    date: 'Jul 5, 2026',
    title: 'Qom funeral procession',
    kind: 'diplomacy',
    places: [{ name: 'Qom', at: [34.64, 50.876], c: 'H' }],
  },
  {
    date: 'Jul 6, 2026',
    title: 'Main Tehran funeral procession',
    kind: 'diplomacy',
    places: [{ name: 'Azadi Square, Tehran', at: [35.699, 51.338], c: 'H' }],
  },
  {
    date: 'Jul 7, 2026',
    title: 'Khamenei body reportedly begins Najaf',
    kind: 'diplomacy',
    places: [
      { name: 'Najaf', at: [31.996, 44.314], c: 'U' },
      { name: 'Karbala', at: [32.616, 44.024], c: 'U' },
    ],
  },
  {
    date: 'Jul 8, 2026',
    title: 'CENTCOM launches powerful strikes on Iran',
    kind: 'us-strike',
    places: [
      { name: 'Sirik', at: [26.519, 57.105], c: 'A' },
      { name: 'Bandar Abbas', at: [27.183, 56.267], c: 'H' },
      { name: 'Qeshm Island', at: [26.8, 55.95], c: 'A' },
    ],
  },
  {
    date: 'Jul 8-9, 2026',
    title: 'Trump declares ceasefire over',
    kind: 'us-strike',
    places: [
      { name: 'Chabahar', at: [25.292, 60.643], c: 'H' },
      { name: 'Konarak', at: [25.36, 60.399], c: 'H' },
    ],
  },
  {
    date: 'Jul 9, 2026',
    title: 'Iran fires 10 missiles at Jordan s Azraq air base',
    kind: 'iran-attack',
    places: [
      {
        name: 'Muwaffaq Salti AB (Azraq), Jordan',
        at: [31.827, 36.782],
        c: 'H',
      },
    ],
  },
  {
    date: 'Jul 11-12, 2026',
    title: 'IRGC strikes Cyprus-flagged ship GFS Galaxy',
    kind: 'maritime',
    places: [
      { name: 'GFS Galaxy, Strait of Hormuz', at: [26.55, 56.4], c: 'U' },
    ],
  },
  {
    date: 'Jul 12-13, 2026',
    title: 'CENTCOM hits ~140 targets',
    kind: 'iran-attack',
    places: [
      { name: 'Al Udeid AB, Qatar', at: [25.117, 51.315], c: 'H' },
      { name: 'Prince Hassan AB (H5), Jordan', at: [32.16, 37.149], c: 'A' },
      { name: 'Port of Duqm, Oman', at: [19.66, 57.71], c: 'A' },
      { name: 'Ali Al Salem AB, Kuwait', at: [29.347, 47.521], c: 'H' },
      {
        name: 'Mahshahr (US strike)',
        at: [30.558, 49.198],
        c: 'H',
        kind: 'us-strike',
      },
    ],
  },
  {
    date: 'Jul 13-14, 2026',
    title: 'US official KIA tally rises',
    kind: 'maritime',
    places: [{ name: 'Tanker attack, Omani waters', at: [24.8, 57.2], c: 'U' }],
  },
  {
    date: 'Jul 14-15, 2026',
    title: 'CENTCOM 4th consecutive day of strikes',
    kind: 'us-strike',
    places: [
      { name: 'Bushehr', at: [28.969, 50.838], c: 'H' },
      { name: 'Chabahar', at: [25.292, 60.643], c: 'H' },
      { name: 'Jask', at: [25.644, 57.775], c: 'H' },
      { name: 'Konarak', at: [25.36, 60.399], c: 'H' },
      { name: 'Abu Musa', at: [25.873, 55.033], c: 'H' },
      { name: 'Bandar Abbas', at: [27.183, 56.267], c: 'H' },
    ],
  },
  {
    date: 'Jul 17-18, 2026',
    title: 'CENTCOM 6th-7th consecutive nights',
    kind: 'us-strike',
    places: [
      { name: 'Bandar Abbas rail junction', at: [27.2, 56.28], c: 'A' },
      { name: 'Iranshahr airport', at: [27.203, 60.685], c: 'A' },
      { name: 'Chabahar', at: [25.292, 60.643], c: 'H' },
    ],
  },
  {
    date: 'Jul 17-18, 2026',
    title: 'First US combat deaths since March',
    kind: 'iran-attack',
    places: [
      {
        name: 'Muwaffaq Salti AB (Azraq), Jordan',
        at: [31.827, 36.782],
        c: 'H',
      },
      {
        name: 'Yazd (US strike)',
        at: [31.897, 54.357],
        c: 'H',
        kind: 'us-strike',
      },
    ],
  },
  {
    date: 'Jul 18-19, 2026',
    title: 'US soldier dies in Iraq EOD blast',
    kind: 'loss',
    places: [{ name: 'Northern Iraq', at: [36.2, 44.0], c: 'U' }],
  },
  {
    date: 'Jul 22, 2026',
    title: 'IRGC drones hit Kuwait s Camp Doha',
    kind: 'iran-attack',
    places: [{ name: 'Camp Doha, Kuwait', at: [29.36, 47.8], c: 'A' }],
  },
  {
    date: 'Jul 23, 2026',
    title: 'CENTCOM opens 12th strike night',
    kind: 'us-strike',
    places: [
      { name: 'Ahvaz', at: [31.318, 48.671], c: 'H' },
      { name: 'Shalamcheh crossing', at: [30.5, 47.99], c: 'A' },
    ],
  },
  {
    date: 'Jul 23-24, 2026',
    title: 'CENTCOM opens 13th strike night',
    kind: 'us-strike',
    places: [
      { name: 'Ahvaz', at: [31.318, 48.671], c: 'H' },
      { name: 'Bandar Abbas', at: [27.183, 56.267], c: 'H' },
    ],
  },
  {
    date: 'Jul 28, 2026',
    title: 'Iran missiles at Jordan base intercepted',
    kind: 'iran-attack',
    places: [
      { name: 'US base in Jordan (unnamed)', at: [31.827, 36.782], c: 'U' },
      {
        name: 'US-Saudi strikes, eastern Iraq',
        at: [33.3, 45.0],
        c: 'U',
        kind: 'us-strike',
      },
    ],
  },
  {
    date: 'Jul 29, 2026',
    title: 'Iraq PMF confirms 20 killed',
    kind: 'loss',
    places: [
      { name: 'PMF bases, Iraq (7 provinces)', at: [33.3, 44.4], c: 'U' },
    ],
  },
  {
    date: 'Jul 30, 2026',
    title: 'Kuwait strike kills 1 worker',
    kind: 'iran-attack',
    places: [
      { name: 'Northern Kuwait', at: [29.7, 47.7], c: 'U' },
      {
        name: 'Qeshm Island (US strike)',
        at: [26.8, 55.95],
        c: 'A',
        kind: 'us-strike',
      },
    ],
  },
  {
    date: 'Aug 5, 2026',
    title: '2 IDF reservists killed in Lebanon IED blast',
    kind: 'loss',
    places: [{ name: 'Majdal Zoun', at: [33.15, 35.27], c: 'A' }],
  },
  {
    date: 'Aug 6-7, 2026',
    title: 'Houthi attacks kill up to 58',
    kind: 'iran-attack',
    places: [
      { name: 'Marib', at: [15.463, 45.325], c: 'H' },
      { name: 'Hadhramaut', at: [15.94, 48.79], c: 'U' },
    ],
  },
  {
    date: 'Aug 7, 2026',
    title: 'Pakistan, Saudi Arabia, Turkiye sign Mecca',
    kind: 'diplomacy',
    places: [{ name: 'Mecca', at: [21.389, 39.858], c: 'H' }],
  },
  {
    date: 'Aug 8, 2026',
    title: 'Iran missile strikes ADNOC tanker in Hormuz',
    kind: 'maritime',
    places: [{ name: 'Strait of Hormuz', at: [26.5, 56.4], c: 'U' }],
  },
  {
    date: 'Aug 11, 2026',
    title: 'CENTCOM disables blockade-running tanker Vela Nova',
    kind: 'maritime',
    places: [
      { name: 'Gulf of Oman, ~71 nm off Pakistan', at: [24.3, 61.3], c: 'U' },
    ],
  },
  {
    date: 'Aug 11, 2026',
    title: 'Houthi attack kills 6 in Bab el-Mandeb',
    kind: 'maritime',
    places: [{ name: 'Bab el-Mandeb', at: [12.58, 43.33], c: 'A' }],
  },
  {
    date: 'Aug 17-18, 2026',
    title: 'Chief engineer killed as bulker struck',
    kind: 'maritime',
    places: [
      {
        name: 'Minoan Dignity, Hormuz southern corridor',
        at: [26.38, 56.52],
        c: 'A',
      },
    ],
  },
  {
    date: 'Aug 25, 2026',
    title: 'Iran, Oman unveil temporary Hormuz corridor',
    kind: 'diplomacy',
    places: [{ name: 'Strait of Hormuz', at: [26.57, 56.25], c: 'A' }],
  },
  {
    date: 'Aug 24-25, 2026',
    title: 'Two unclaimed projectile strikes disable tankers',
    kind: 'maritime',
    places: [
      { name: 'Off Ash Shishah, Oman', at: [26.25, 56.45], c: 'U' },
      { name: 'Off Khasab, Oman', at: [26.2, 56.28], c: 'A' },
    ],
  },
  {
    date: 'Aug 27, 2026',
    title: 'Qatar s PM visits Tehran',
    kind: 'diplomacy',
    places: [{ name: 'Tehran', at: [35.689, 51.389], c: 'H' }],
  },
  {
    date: 'Aug 30, 2026',
    title: 'CENTCOM strikes Larak Island',
    kind: 'us-strike',
    places: [{ name: 'Larak Island', at: [26.855, 56.36], c: 'H' }],
  },
  {
    date: 'Aug 31, 2026',
    title: 'IRGC missile/drone strikes on two US bases in Jordan',
    kind: 'iran-attack',
    places: [
      {
        name: 'Muwaffaq Salti AB (Azraq), Jordan',
        at: [31.827, 36.782],
        c: 'H',
      },
    ],
  },
  {
    date: 'Sep 1, 2026',
    title: 'Larak Island IRGC death toll',
    kind: 'loss',
    places: [{ name: 'Larak Island', at: [26.855, 56.36], c: 'H' }],
  },
  {
    date: 'Sep 1, 2026',
    title: 'US strike hits wedding in Sirik',
    kind: 'us-strike',
    places: [{ name: 'Kuhestak, Sirik county', at: [26.8, 57.03], c: 'U' }],
  },
  {
    date: 'Sep 1-3, 2026',
    title: 'Iran Health Ministry raises Sep 1 strikes',
    kind: 'loss',
    places: [
      { name: 'Sirik county', at: [26.519, 57.105], c: 'A' },
      { name: 'Khuzestan', at: [31.318, 48.671], c: 'U' },
    ],
  },
  {
    date: 'Sep 3, 2026',
    title: 'Iran claims Kuwait, UAE base strikes',
    kind: 'iran-attack',
    places: [
      { name: 'Ahmad al-Jaber AB, Kuwait', at: [28.935, 47.792], c: 'H' },
      { name: 'Al Minhad AB, UAE', at: [25.027, 55.366], c: 'H' },
    ],
  },
  {
    date: 'Sep 1-2, 2026',
    title: 'Iran retaliates on Jordan, Bahrain, Kuwait',
    kind: 'iran-attack',
    places: [
      {
        name: 'Camp Titin, Jordan (location unpublished)',
        at: [31.9, 36.3],
        c: 'U',
      },
    ],
  },
  {
    date: 'Sep 3, 2026',
    title: 'Iran reports running weekly military toll',
    kind: 'loss',
    places: [{ name: 'Lavan Island', at: [26.81, 53.35], c: 'A' }],
  },
  {
    date: 'Sep 4, 2026',
    title: 'Israeli strikes kill 3, wound 23',
    kind: 'israel-strike',
    places: [
      { name: 'Tyre', at: [33.273, 35.194], c: 'H' },
      { name: 'Nabatieh', at: [33.378, 35.484], c: 'H' },
      { name: 'Bekaa', at: [33.85, 35.9], c: 'U' },
    ],
  },
  {
    date: 'Sep 3, 2026',
    title: 'Kuhestak wedding-strike death toll',
    kind: 'loss',
    places: [{ name: 'Kuhestak, Sirik county', at: [26.8, 57.03], c: 'U' }],
  },
  {
    date: 'Sep 6, 2026',
    title: 'IRGC retaliates on tankers',
    kind: 'maritime',
    places: [{ name: 'Strait of Hormuz', at: [26.5, 56.4], c: 'U' }],
  },
  {
    date: 'Sep 8, 2026',
    title: 'CENTCOM destroys 5 more tankers',
    kind: 'us-strike',
    places: [
      { name: 'Gulf of Oman', at: [25.0, 58.0], c: 'U' },
      { name: 'Near Kharg Island', at: [29.25, 50.32], c: 'A' },
      {
        name: 'Al Azraq base, Jordan',
        at: [31.827, 36.782],
        c: 'H',
        kind: 'iran-attack',
      },
    ],
  },
  {
    date: 'Sep 9, 2026',
    title: 'Iran claims 10-ship Hormuz attack',
    kind: 'maritime',
    places: [
      { name: 'Hercules Star, anchorage off Dubai', at: [25.3, 55.1], c: 'A' },
    ],
  },
  {
    date: 'Sep 9, 2026',
    title: 'CBS: Jordan strike damaged US A-10',
    kind: 'loss',
    places: [
      {
        name: 'Muwaffaq Salti AB (Azraq), Jordan',
        at: [31.827, 36.782],
        c: 'H',
      },
    ],
  },
  {
    date: 'Sep 10, 2026',
    title: 'Iranian state media reports unconfirmed',
    kind: 'unattributed',
    places: [
      { name: 'Sirik', at: [26.519, 57.105], c: 'A' },
      { name: 'Minab', at: [27.147, 57.08], c: 'H' },
      { name: 'Qeshm Island', at: [26.8, 55.95], c: 'A' },
    ],
  },
  {
    date: 'Sep 10, 2026',
    title: 'IRGC hits US sea drone',
    kind: 'maritime',
    places: [{ name: 'Off Khasab, Oman', at: [26.2, 56.28], c: 'A' }],
  },
  {
    date: 'Sep 13, 2026',
    title: 'Unclaimed strike off Qeshm',
    kind: 'maritime',
    places: [{ name: 'Off Hengam Island', at: [26.65, 55.89], c: 'A' }],
  },
  {
    date: 'Sep 17, 2026',
    title: 'UN experts find possible war crimes',
    kind: 'diplomacy',
    places: [{ name: 'Minab (school strike)', at: [27.147, 57.08], c: 'A' }],
  },
  {
    date: 'Sep 14, 2026',
    title: 'US drone kills most of two IRGC boat crews',
    kind: 'us-strike',
    places: [{ name: 'Off Hormozgan coast', at: [26.9, 56.8], c: 'U' }],
  },
  {
    date: 'Sep 21, 2026',
    title: 'Tanker La Stephanie hit entering Hormuz',
    kind: 'maritime',
    places: [
      { name: 'Strait of Hormuz (inbound lane)', at: [26.45, 56.55], c: 'U' },
    ],
  },
]);
