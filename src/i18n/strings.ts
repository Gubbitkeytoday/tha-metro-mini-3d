/**
 * UI strings.
 *
 * ## What "choose any language" can and cannot mean here
 *
 * There are two separate things a language setting controls, and they have
 * very different limits:
 *
 * 1. **UI chrome** (the words in this file). Finite, short, and translatable —
 *    every language below is fully authored.
 * 2. **Station names.** These are *data*, not strings we own. They come from
 *    OpenStreetMap's `name:<lang>` tags, and the coverage is what it is:
 *    surveyed live on 2026-08-02 across all ten lines, `en` 194/195 stations,
 *    `th` 151, `zh` 27, `ja` 18, `ko` 4, `fr` 4, `ru` 2, `de` 1.
 *
 * So the language picker offers what genuinely exists rather than a long list
 * that silently renders English underneath. `src/i18n/languages.ts` derives
 * the offered list from the loaded network data and reports each language's
 * real station coverage, and a station with no name in the chosen language
 * falls back visibly (see `stationName()`), instead of pretending.
 *
 * Adding a language is one entry here plus whatever OSM already has — nothing
 * else in the app needs to change.
 *
 * Tables are typed `Partial<Strings>` and merged over English per key, so a
 * table that falls behind a new feature degrades one string at a time rather
 * than dropping a whole language back to English.
 */

export const UI_LANGUAGES = ["en", "th", "zh", "ja", "ko", "fr", "de", "ru", "es"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

/** Every user-visible string in the app chrome. */
export interface Strings {
  appTitle: string;
  tapHint: string;
  loadingMap: string;
  lines: string;
  trackOnly: string;
  view: string;
  stationNames: string;
  seeThroughTunnels: string;
  buildings: string;
  shadows: string;
  lighting: string;
  auto: string;
  day: string;
  night: string;
  nowDay: string;
  nowNight: string;
  language: string;
  myLocation: string;
  locating: string;
  stopLocating: string;
  scrub: string;
  now: string;
  bangkok: string;
  trains: string;
  train: string;
  station: string;
  schedule: string;
  nextDepartures: string;
  interchange: string;
  followThisTrain: string;
  following: string;
  terminus: string;
  loading: string;
  runFinished: string;
  noMoreServices: string;
  dwellingAt: string;
  departed: string;
  next: string;
  closeInspector: string;
  closeStationBoard: string;
  showPanel: string;
  hidePanel: string;
  engineError: string;

  // ---- Guided tour. The forward button reuses `next`. ----
  tourLabel: string;
  skip: string;
  back: string;
  tourFinish: string;
  tourWelcomeTitle: string;
  tourWelcomeBody: string;
  tourLinesTitle: string;
  tourLinesBody: string;
  tourLabelsTitle: string;
  tourLabelsBody: string;
  tourUndergroundTitle: string;
  tourUndergroundBody: string;
  tourLightingTitle: string;
  tourLightingBody: string;
  tourLanguageTitle: string;
  tourLanguageBody: string;
  tourLocationTitle: string;
  tourLocationBody: string;
  tourTimeTitle: string;
  tourTimeBody: string;
  tourWarpTitle: string;
  tourWarpBody: string;
  tourTrainsTitle: string;
  tourTrainsBody: string;
  tourCameraTitle: string;
  tourCameraBody: string;
  tourPlannerTitle: string;
  tourPlannerBody: string;
  tourHelpTitle: string;
  tourHelpBody: string;
  tourDoneTitle: string;
  tourDoneBody: string;

  // ---- About / privacy / support ----
  about: string;
  close: string;
  aboutBody: string;
  aboutData: string;
  aboutDataBody: string;
  aboutPrivacy: string;
  aboutPrivacyBody: string;
  aboutProject: string;
  clearSettings: string;
  support: string;
  supportBody: string;
  sourceCode: string;
  reportProblem: string;
  replayTour: string;
  /** `{named}` / `{total}` placeholders — station names, not UI strings. */
  stationNameCoverage: string;

  // ---- Support ----
  copy: string;
  copied: string;
  promptPayQrAlt: string;
  promptPayVerify: string;

  // ---- Search & journey planner ----
  planTrip: string;
  from: string;
  to: string;
  chooseStation: string;
  searchPlaceholder: string;
  noStationFound: string;
  showOnMap: string;
  noRouteFound: string;
  sameStation: string;
  noChanges: string;
  oneChange: string;
  someChanges: string;
  minutes: string;
  changeHere: string;
  boardAt: string;
  rideStops: string;
  alightAt: string;
  plannerHint: string;
}

const en: Strings = {
  appTitle: "Greater Bangkok Metro Mini 3D",
  tapHint: "Tap a train or station to inspect it.",
  loadingMap: "Loading map…",
  lines: "Lines",
  trackOnly: "track only",
  view: "View",
  stationNames: "Station names",
  seeThroughTunnels: "See through tunnels",
  buildings: "3D buildings",
  shadows: "Shadows",
  lighting: "Lighting",
  auto: "Auto",
  day: "Day",
  night: "Night",
  nowDay: "now day",
  nowNight: "now night",
  language: "Language",
  myLocation: "My location",
  locating: "Locating…",
  stopLocating: "Stop locating",
  scrub: "Scrub",
  now: "Now",
  bangkok: "Bangkok",
  trains: "trains",
  train: "train",
  station: "Station",
  schedule: "Schedule",
  nextDepartures: "Next departures",
  interchange: "Interchange",
  followThisTrain: "Follow this train",
  following: "Following — tap to release",
  terminus: "Terminus — end of run.",
  loading: "Loading…",
  runFinished: "This run has finished its journey. Pick another train.",
  noMoreServices: "No further services scheduled today.",
  dwellingAt: "Dwelling at",
  departed: "Departed",
  next: "Next",
  closeInspector: "Close inspector",
  closeStationBoard: "Close station board",
  showPanel: "Show lines and view options",
  hidePanel: "Hide lines and view options",
  engineError: "Engine error",

  tourLabel: "Step",
  skip: "Skip",
  back: "Back",
  tourFinish: "Start exploring",
  tourWelcomeTitle: "Welcome aboard",
  tourWelcomeBody:
    "Greater Bangkok's rail network in 3D — 10 lines, 193 stations, 8,193 runs a day, every train placed by its published timetable. This tour highlights each control in turn. Skip any time.",
  tourLinesTitle: "The lines",
  tourLinesBody:
    "This list is both the legend and the filter. Tap a line to hide its track, stations and trains. The simulation keeps running underneath, so the counts and timetables stay honest.",
  tourLabelsTitle: "What is drawn",
  tourLabelsBody:
    "Station names float above their platforms and always face you. 3D buildings give the city depth — turn them off to see elevated track from a low angle, or to speed things up on a slower device.",
  tourUndergroundTitle: "Look underground",
  tourUndergroundBody:
    "MRT Blue runs in tunnel through the city core at a real −18 m. See-through tunnels draws that buried track through the buildings above it — it is on now, so look at the centre of the map.",
  tourLightingTitle: "Day and night",
  tourLightingBody:
    "On Auto the sun is placed by a real solar calculation for the simulated time, so dawn looks like dawn. It has switched to Night so you can see the difference; Auto comes back when the tour ends.",
  tourLanguageTitle: "Your language",
  tourLanguageBody:
    "One setting changes everything — interface, line names and station labels — into that language only. The percentage is how much of the network each language actually names, since names come from OpenStreetMap.",
  tourLocationTitle: "Where you are",
  tourLocationBody:
    "Put your own GPS position on the map, with a circle showing how accurate the fix is. Nothing touches your location until you press this, and your position never leaves your device.",
  tourTimeTitle: "The clock",
  tourTimeBody:
    "Drag this to any moment of the Bangkok day and the whole network jumps to where it should be then. Rush hour, last train, three in the morning — all of it is there.",
  tourWarpTitle: "Speed and now",
  tourWarpBody:
    "Run time at 1× to 60×. At 60× a whole service day passes in about twenty-four minutes. ‘Now’ snaps the clock back to the real time in Bangkok.",
  tourTrainsTitle: "Tap a train",
  tourTrainsBody:
    "Every moving box on the map is one scheduled run. Tap one for its destination, its next stop with a live countdown and its full timetable — then follow it in third person. Tapping a station opens its departure board.",
  tourCameraTitle: "Move the camera",
  tourCameraBody:
    "Drag to pan, scroll to zoom. To orbit, hold the right or middle mouse button. On a touchscreen, twist with two fingers to turn and drag two fingers up or down to tilt.",
  tourHelpTitle: "Help and data",
  tourHelpBody:
    "This button reopens the tour any time, and explains where the data comes from and exactly what is stored on your device.",
  tourDoneTitle: "That's everything",
  tourDoneBody: "Enjoy the ride. Everything you just saw is switching back to how it was.",

  about: "About",
  close: "Close",
  aboutBody:
    "Greater Bangkok Metro Mini 3D shows the region's rail network in 3D, animating trains along real track geometry from published static timetables. It is a schedule simulation, not a live vehicle feed: it shows where trains are meant to be, which is why you can scrub to any time of day.",
  aboutData: "Data",
  aboutDataBody:
    "Timetables and station coordinates come from the Namtang / OTP open-data GTFS feed (CC-BY 4.0). Track geometry, station names and their translations come from OpenStreetMap (ODbL). The base map is OpenFreeMap.",
  aboutPrivacy: "Privacy",
  aboutPrivacyBody:
    "No cookies, no analytics, no accounts, no tracking of any kind. The only thing kept is your view settings — language, which lines are shown, the toggles above — stored on this device so the app looks the same next visit. If you use ‘My location’, your position is drawn on the map and never leaves your device.",
  aboutProject: "Project",
  clearSettings: "Forget my settings",
  support: "Support this project",
  supportBody:
    "It is free, open source, and has no ads. If it is useful to you, you are welcome to chip in — entirely optional.",
  sourceCode: "Source code",
  reportProblem: "Report a problem",
  replayTour: "Replay the tour",
  stationNameCoverage:
    "Station names in this language: {named} of {total}. The rest fall back to English. Names come from OpenStreetMap.",
  planTrip:
    "Plan a trip",
  from:
    "From",
  to:
    "To",
  chooseStation:
    "Choose a station",
  searchPlaceholder:
    "Search a station — any language, or its code",
  noStationFound:
    "No station matches that.",
  showOnMap:
    "Show on the map",
  noRouteFound:
    "No route found between these two.",
  sameStation:
    "That is the same place — you are already there.",
  noChanges:
    "no changes",
  oneChange:
    "1 change",
  someChanges:
    "{n} changes",
  minutes:
    "min",
  changeHere:
    "Change here",
  boardAt:
    "Board at {station}",
  rideStops:
    "Ride {n} stops",
  alightAt:
    "get off at {station}",
  plannerHint:
    "Type a station name in any language, or its code like E4. Pick where you are, then where you are going, and you will get which line to take and where to change.",
  tourPlannerTitle: "Getting somewhere",
  tourPlannerBody:
    "New to Bangkok? Tap the magnifier. Search any station by name — in any language — or by its code, then pick where you are and where you want to go. You get the line to take, how many stops, and exactly where to change.",
  copy:
    "Copy",
  copied:
    "Copied",
  promptPayQrAlt:
    "PromptPay QR code for donations",
  promptPayVerify:
    "Check the number under the code before you pay — it should match your banking app.",
};

const th: Partial<Strings> = {
  appTitle: "รถไฟฟ้ากรุงเทพ 3 มิติ",
  tapHint: "แตะขบวนรถหรือสถานีเพื่อดูรายละเอียด",
  loadingMap: "กำลังโหลดแผนที่…",
  lines: "สายรถไฟฟ้า",
  trackOnly: "เฉพาะราง",
  view: "มุมมอง",
  stationNames: "ชื่อสถานี",
  seeThroughTunnels: "มองทะลุอุโมงค์",
  buildings: "อาคาร 3 มิติ",
  shadows: "เงา",
  lighting: "แสง",
  auto: "อัตโนมัติ",
  day: "กลางวัน",
  night: "กลางคืน",
  nowDay: "ตอนนี้กลางวัน",
  nowNight: "ตอนนี้กลางคืน",
  language: "ภาษา",
  myLocation: "ตำแหน่งของฉัน",
  locating: "กำลังหาตำแหน่ง…",
  stopLocating: "หยุดติดตามตำแหน่ง",
  scrub: "เลื่อนเวลา",
  now: "ตอนนี้",
  bangkok: "กรุงเทพฯ",
  trains: "ขบวน",
  train: "ขบวน",
  station: "สถานี",
  schedule: "ตารางเวลา",
  nextDepartures: "เที่ยวถัดไป",
  interchange: "เปลี่ยนสาย",
  followThisTrain: "ติดตามขบวนนี้",
  following: "กำลังติดตาม — แตะเพื่อเลิก",
  terminus: "สถานีปลายทาง — สิ้นสุดเที่ยว",
  loading: "กำลังโหลด…",
  runFinished: "เที่ยวนี้สิ้นสุดแล้ว เลือกขบวนอื่น",
  noMoreServices: "ไม่มีเที่ยวเดินรถเหลือในวันนี้",
  dwellingAt: "จอดที่",
  departed: "ออกจาก",
  next: "ถัดไป",
  closeInspector: "ปิดหน้าต่างรายละเอียด",
  closeStationBoard: "ปิดตารางสถานี",
  showPanel: "แสดงรายการสายและมุมมอง",
  hidePanel: "ซ่อนรายการสายและมุมมอง",
  engineError: "เอนจินขัดข้อง",

  tourLabel: "ขั้นที่",
  skip: "ข้าม",
  back: "ย้อนกลับ",
  tourFinish: "เริ่มใช้งาน",
  tourWelcomeTitle: "ยินดีต้อนรับ",
  tourWelcomeBody:
    "โครงข่ายรถไฟฟ้ากรุงเทพฯ และปริมณฑลแบบ 3 มิติ — 10 สาย 193 สถานี 8,193 เที่ยวต่อวัน ทุกขบวนวางตำแหน่งตามตารางเดินรถจริง การแนะนำนี้จะไฮไลต์ทีละส่วน กดข้ามได้ตลอด",
  tourLinesTitle: "รายการสาย",
  tourLinesBody:
    "รายการนี้เป็นทั้งคำอธิบายสีและตัวกรอง แตะที่สายเพื่อซ่อนราง สถานี และขบวนรถของสายนั้น การจำลองยังทำงานอยู่เบื้องหลัง ตัวเลขและตารางเวลาจึงยังตรงตามจริง",
  tourLabelsTitle: "สิ่งที่แสดงบนแผนที่",
  tourLabelsBody:
    "ชื่อสถานีลอยเหนือชานชาลาและหันเข้าหาคุณเสมอ อาคาร 3 มิติช่วยให้เห็นมิติของเมือง ปิดได้ถ้าอยากเห็นรางยกระดับจากมุมต่ำ หรือให้ลื่นขึ้นบนเครื่องที่แรงน้อย",
  tourUndergroundTitle: "มองลงไปใต้ดิน",
  tourUndergroundBody:
    "MRT สายสีน้ำเงินวิ่งในอุโมงค์ผ่านใจกลางเมืองที่ระดับ −18 เมตรจริง โหมดมองทะลุอุโมงค์จะวาดรางใต้ดินทะลุตึกด้านบนขึ้นมา ตอนนี้เปิดอยู่ ลองดูกลางแผนที่",
  tourLightingTitle: "กลางวันและกลางคืน",
  tourLightingBody:
    "โหมดอัตโนมัติคำนวณตำแหน่งดวงอาทิตย์จริงตามเวลาที่จำลองอยู่ เช้าตรู่ก็จะเห็นเป็นเช้าตรู่ ตอนนี้สลับเป็นกลางคืนให้ดูความต่าง และจะกลับเป็นอัตโนมัติเมื่อจบการแนะนำ",
  tourLanguageTitle: "ภาษาของคุณ",
  tourLanguageBody:
    "ตั้งค่าเดียวเปลี่ยนทั้งหมด — หน้าจอ ชื่อสาย และชื่อสถานี เป็นภาษานั้นล้วน ตัวเลขเปอร์เซ็นต์คือสัดส่วนสถานีที่มีชื่อในภาษานั้นจริง เพราะชื่อสถานีมาจาก OpenStreetMap",
  tourLocationTitle: "ตำแหน่งของคุณ",
  tourLocationBody:
    "แสดงพิกัด GPS ของคุณบนแผนที่ พร้อมวงกลมบอกความแม่นยำ จะไม่มีการอ่านตำแหน่งจนกว่าคุณจะกดปุ่มนี้ และพิกัดไม่ถูกส่งออกจากเครื่องคุณ",
  tourTimeTitle: "นาฬิกา",
  tourTimeBody:
    "ลากไปเวลาไหนของวันก็ได้ แล้วทั้งโครงข่ายจะกระโดดไปยังตำแหน่งของเวลานั้น ชั่วโมงเร่งด่วน เที่ยวสุดท้าย หรือตีสาม มีครบ",
  tourWarpTitle: "ความเร็วและปุ่มตอนนี้",
  tourWarpBody:
    "เร่งเวลาได้ตั้งแต่ 1× ถึง 60× ที่ 60× หนึ่งวันเดินรถผ่านไปในราวยี่สิบสี่นาที ปุ่ม “ตอนนี้” ดึงนาฬิกากลับมาที่เวลาจริงของกรุงเทพฯ",
  tourTrainsTitle: "แตะที่ขบวนรถ",
  tourTrainsBody:
    "กล่องที่เคลื่อนที่ทุกกล่องคือหนึ่งเที่ยววิ่งตามตาราง แตะเพื่อดูปลายทาง สถานีถัดไปพร้อมเวลานับถอยหลัง และตารางเวลาทั้งเที่ยว แล้วกดติดตามเพื่อดูมุมกล้องตามขบวน ส่วนการแตะสถานีจะเปิดตารางเที่ยวถัดไป",
  tourCameraTitle: "ควบคุมมุมกล้อง",
  tourCameraBody:
    "ลากเพื่อเลื่อน หมุนล้อเพื่อซูม หมุนมุมมองด้วยการกดเมาส์ขวาหรือปุ่มกลางค้างไว้ บนจอสัมผัสใช้สองนิ้วบิดเพื่อหมุน และลากสองนิ้วขึ้นลงเพื่อปรับมุมก้มเงย",
  tourHelpTitle: "ความช่วยเหลือและข้อมูล",
  tourHelpBody:
    "ปุ่มนี้เปิดการแนะนำนี้ซ้ำได้ทุกเมื่อ พร้อมบอกที่มาของข้อมูล และรายละเอียดว่าเก็บอะไรไว้บนเครื่องคุณบ้าง",
  tourDoneTitle: "เท่านี้แหละ",
  tourDoneBody: "ขอให้สนุกกับการเดินทาง ทุกอย่างที่เพิ่งดูจะถูกปรับกลับเป็นค่าเดิมให้แล้ว",

  about: "เกี่ยวกับ",
  close: "ปิด",
  aboutBody:
    "รถไฟฟ้ากรุงเทพ 3 มิติ แสดงโครงข่ายรถไฟฟ้าของกรุงเทพฯ และปริมณฑลแบบสามมิติ โดยเคลื่อนขบวนรถไปตามแนวรางจริงด้วยตารางเดินรถที่เผยแพร่ไว้ นี่คือการจำลองตามตารางเวลา ไม่ใช่สัญญาณตำแหน่งรถจริง จึงบอกว่ารถ “ควรจะ” อยู่ตรงไหน และเป็นเหตุผลที่เลื่อนดูเวลาใดก็ได้",
  aboutData: "ข้อมูล",
  aboutDataBody:
    "ตารางเดินรถและพิกัดสถานีมาจากฟีด GTFS ของ Namtang / OTP open data (CC-BY 4.0) แนวราง ชื่อสถานี และคำแปลมาจาก OpenStreetMap (ODbL) แผนที่ฐานใช้ OpenFreeMap",
  aboutPrivacy: "ความเป็นส่วนตัว",
  aboutPrivacyBody:
    "ไม่มีคุกกี้ ไม่มีการเก็บสถิติ ไม่มีบัญชีผู้ใช้ ไม่มีการติดตามใด ๆ ทั้งสิ้น สิ่งเดียวที่เก็บไว้คือการตั้งค่ามุมมองของคุณ — ภาษา สายที่เปิด และสวิตช์ต่าง ๆ — เก็บไว้บนเครื่องนี้เพื่อให้หน้าตาเหมือนเดิมเมื่อกลับมา หากใช้ “ตำแหน่งของฉัน” พิกัดจะถูกวาดบนแผนที่เท่านั้น และไม่ถูกส่งออกจากเครื่องคุณ",
  aboutProject: "โครงการ",
  clearSettings: "ล้างการตั้งค่าของฉัน",
  support: "สนับสนุนโครงการนี้",
  supportBody:
    "โครงการนี้ใช้ฟรี เป็นโอเพนซอร์ส และไม่มีโฆษณา ถ้าเป็นประโยชน์กับคุณ จะช่วยสนับสนุนก็ยินดี ไม่สนับสนุนก็ใช้ได้เต็มที่เหมือนเดิม",
  sourceCode: "ซอร์สโค้ด",
  reportProblem: "แจ้งปัญหา",
  replayTour: "ดูการแนะนำอีกครั้ง",
  stationNameCoverage:
    "ชื่อสถานีในภาษานี้: {named} จาก {total} ที่เหลือจะแสดงเป็นภาษาอังกฤษ ชื่อสถานีมาจาก OpenStreetMap",
  planTrip:
    "วางแผนการเดินทาง",
  from:
    "จาก",
  to:
    "ไป",
  chooseStation:
    "เลือกสถานี",
  searchPlaceholder:
    "ค้นหาสถานี — ภาษาใดก็ได้ หรือรหัสสถานี",
  noStationFound:
    "ไม่พบสถานีที่ตรงกัน",
  showOnMap:
    "ดูบนแผนที่",
  noRouteFound:
    "ไม่พบเส้นทางระหว่างสองสถานีนี้",
  sameStation:
    "เป็นที่เดียวกัน คุณอยู่ที่นั่นแล้ว",
  noChanges:
    "ไม่ต้องเปลี่ยนสาย",
  oneChange:
    "เปลี่ยนสาย 1 ครั้ง",
  someChanges:
    "เปลี่ยนสาย {n} ครั้ง",
  minutes:
    "นาที",
  changeHere:
    "เปลี่ยนสายที่นี่",
  boardAt:
    "ขึ้นรถที่ {station}",
  rideStops:
    "นั่งไป {n} สถานี",
  alightAt:
    "ลงที่ {station}",
  plannerHint:
    "พิมพ์ชื่อสถานีภาษาใดก็ได้ หรือรหัสอย่าง E4 เลือกจุดที่อยู่ตอนนี้แล้วเลือกปลายทาง ระบบจะบอกว่าขึ้นสายไหนและเปลี่ยนสายที่ไหน",
  tourPlannerTitle: "จะไปที่ไหน",
  tourPlannerBody:
    "เพิ่งมากรุงเทพ? แตะรูปแว่นขยาย ค้นหาสถานีด้วยชื่อภาษาใดก็ได้ หรือด้วยรหัสสถานี แล้วเลือกจุดที่อยู่ตอนนี้กับปลายทาง ระบบจะบอกว่าขึ้นสายไหน กี่สถานี และต้องเปลี่ยนสายที่ไหน",
  copy:
    "คัดลอก",
  copied:
    "คัดลอกแล้ว",
  promptPayQrAlt:
    "คิวอาร์โค้ดพร้อมเพย์สำหรับบริจาค",
  promptPayVerify:
    "ก่อนโอน ตรวจเบอร์ใต้คิวอาร์ให้ตรงกับที่แอปธนาคารแสดงด้วยนะครับ",
};

const zh: Partial<Strings> = {
  appTitle: "曼谷都会区轨道交通 3D",
  tapHint: "点按列车或车站查看详情。",
  loadingMap: "正在加载地图…",
  lines: "线路",
  trackOnly: "仅轨道",
  view: "视图",
  stationNames: "车站名称",
  seeThroughTunnels: "透视隧道",
  buildings: "3D 建筑",
  shadows: "阴影",
  lighting: "光照",
  auto: "自动",
  day: "白天",
  night: "夜间",
  nowDay: "当前为白天",
  nowNight: "当前为夜间",
  language: "语言",
  myLocation: "我的位置",
  locating: "正在定位…",
  stopLocating: "停止定位",
  scrub: "时间",
  now: "现在",
  bangkok: "曼谷",
  trains: "列车",
  train: "列车",
  station: "车站",
  schedule: "时刻表",
  nextDepartures: "下次发车",
  interchange: "换乘",
  followThisTrain: "跟随此列车",
  following: "跟随中 — 点按取消",
  terminus: "终点站 — 本次运行结束。",
  loading: "加载中…",
  runFinished: "本次运行已结束，请选择其他列车。",
  noMoreServices: "今日已无后续班次。",
  dwellingAt: "停靠于",
  departed: "已驶离",
  next: "下一站",
  closeInspector: "关闭详情",
  closeStationBoard: "关闭车站时刻表",
  showPanel: "显示线路与视图选项",
  hidePanel: "隐藏线路与视图选项",
  engineError: "引擎错误",

  tourLabel: "步骤",
  skip: "跳过",
  back: "上一步",
  tourFinish: "开始探索",
  tourWelcomeTitle: "欢迎登车",
  tourWelcomeBody:
    "这是曼谷都会区轨道交通的 3D 地图 — 10 条线路、193 座车站、每天 8,193 趟车次，每列车都按公布的时刻表定位。本导览会逐一高亮各项功能，随时可跳过。",
  tourLinesTitle: "线路列表",
  tourLinesBody:
    "这份列表既是图例也是筛选器。点按某条线路即可隐藏它的轨道、车站和列车。模拟仍在后台运行，因此数量与时刻表始终如实。",
  tourLabelsTitle: "地图上显示什么",
  tourLabelsBody:
    "车站名称浮在站台上方并始终朝向你。3D 建筑让城市更有层次；关掉它可以从低角度看清高架轨道，在性能较弱的设备上也更流畅。",
  tourUndergroundTitle: "看到地下",
  tourUndergroundBody:
    "MRT 蓝线在市中心以真实的 −18 米深度穿行隧道。透视隧道会把地下轨道透过上方建筑绘制出来 — 现已开启，请看地图中心。",
  tourLightingTitle: "白天与夜间",
  tourLightingBody:
    "自动模式会按模拟时间进行真实的太阳位置计算，所以黎明看起来就是黎明。现已切换到夜间以便对比；导览结束后会恢复自动。",
  tourLanguageTitle: "你的语言",
  tourLanguageBody:
    "一个设置改变全部 — 界面、线路名称和车站标签都只用该语言。百分比表示该语言实际覆盖了多少车站名，因为名称来自 OpenStreetMap。",
  tourLocationTitle: "你在哪里",
  tourLocationBody:
    "把你的 GPS 位置显示在地图上，并用圆圈标出精度。在你按下之前不会读取位置，你的位置也绝不会离开本设备。",
  tourTimeTitle: "时间轴",
  tourTimeBody:
    "拖动到曼谷一天中的任意时刻，整个网络都会跳到那一刻应有的状态。早晚高峰、末班车、凌晨三点，全都在。",
  tourWarpTitle: "倍速与“现在”",
  tourWarpBody:
    "时间可按 1× 到 60× 运行。60× 时，一整个运营日约二十四分钟就过完。“现在”会把时钟拉回曼谷的真实时间。",
  tourTrainsTitle: "点按一列车",
  tourTrainsBody:
    "地图上每个移动的方块都是一趟班次。点按可查看终点站、带实时倒计时的下一站以及完整时刻表，还能以第三人称跟随它。点按车站则打开该站的发车时刻表。",
  tourCameraTitle: "移动镜头",
  tourCameraBody:
    "拖动平移，滚轮缩放。按住鼠标右键或中键可环绕旋转。触摸屏上用两指旋转来转向，两指上下拖动来调整俯仰。",
  tourHelpTitle: "帮助与数据",
  tourHelpBody: "这个按钮随时可重新打开本导览，并说明数据来源以及本设备上究竟存了什么。",
  tourDoneTitle: "就这些",
  tourDoneBody: "祝你旅途愉快。刚才展示的设置都已恢复原状。",

  about: "关于",
  close: "关闭",
  aboutBody:
    "曼谷都会区轨道交通 3D 以三维方式展示该地区的轨道网络，按公布的静态时刻表让列车沿真实轨道几何运行。这是时刻表模拟，不是实时车辆信号：它显示列车“应当”在哪里，这也是你可以任意拖动到某个时刻的原因。",
  aboutData: "数据",
  aboutDataBody:
    "时刻表与车站坐标来自 Namtang / OTP 开放数据的 GTFS 数据集（CC-BY 4.0）。轨道几何、车站名称及其翻译来自 OpenStreetMap（ODbL）。底图为 OpenFreeMap。",
  aboutPrivacy: "隐私",
  aboutPrivacyBody:
    "没有 Cookie，没有统计分析，没有账号，没有任何形式的追踪。唯一保存的是你的视图设置 — 语言、显示哪些线路、上面的开关 — 存在本设备上，方便你下次访问时保持一致。若使用“我的位置”，你的位置只会绘制在地图上，绝不会离开本设备。",
  aboutProject: "项目",
  clearSettings: "清除我的设置",
  support: "支持这个项目",
  supportBody: "本项目免费、开源、无广告。如果它对你有用，欢迎随意赞助 — 完全自愿。",
  sourceCode: "源代码",
  reportProblem: "反馈问题",
  replayTour: "重看导览",
  stationNameCoverage:
    "该语言的车站名称：{total} 个中有 {named} 个。其余回退为英文。名称来自 OpenStreetMap。",
  planTrip:
    "规划行程",
  from:
    "从",
  to:
    "到",
  chooseStation:
    "选择车站",
  searchPlaceholder:
    "搜索车站 — 任意语言或车站代码",
  noStationFound:
    "没有匹配的车站。",
  showOnMap:
    "在地图上显示",
  noRouteFound:
    "两站之间没有可用路线。",
  sameStation:
    "是同一个地方，你已经到了。",
  noChanges:
    "无需换乘",
  oneChange:
    "换乘 1 次",
  someChanges:
    "换乘 {n} 次",
  minutes:
    "分钟",
  changeHere:
    "在此换乘",
  boardAt:
    "在 {station} 上车",
  rideStops:
    "乘坐 {n} 站",
  alightAt:
    "在 {station} 下车",
  plannerHint:
    "用任意语言输入车站名，或输入 E4 这样的代码。先选你现在的位置，再选目的地，就会告诉你坐哪条线、在哪里换乘。",
  tourPlannerTitle: "怎么去",
  tourPlannerBody:
    "初到曼谷？点一下放大镜。用任意语言的站名或车站代码搜索，再选出发地和目的地，就会告诉你坐哪条线、几站、在哪里换乘。",
  copy:
    "复制",
  copied:
    "已复制",
  promptPayQrAlt:
    "用于捐赠的 PromptPay 二维码",
  promptPayVerify:
    "付款前请核对二维码下方的号码，应与银行 App 显示的一致。",
};

const ja: Partial<Strings> = {
  appTitle: "バンコク都市圏 鉄道 3D",
  tapHint: "列車または駅をタップすると詳細が表示されます。",
  loadingMap: "地図を読み込み中…",
  lines: "路線",
  trackOnly: "線路のみ",
  view: "表示",
  stationNames: "駅名",
  seeThroughTunnels: "トンネルを透視",
  buildings: "3D 建物",
  shadows: "影",
  lighting: "照明",
  auto: "自動",
  day: "昼",
  night: "夜",
  nowDay: "現在は昼",
  nowNight: "現在は夜",
  language: "言語",
  myLocation: "現在地",
  locating: "位置を取得中…",
  stopLocating: "位置取得を停止",
  scrub: "時刻",
  now: "現在",
  bangkok: "バンコク",
  trains: "本",
  train: "本",
  station: "駅",
  schedule: "時刻表",
  nextDepartures: "次の発車",
  interchange: "乗換",
  followThisTrain: "この列車を追跡",
  following: "追跡中 — タップで解除",
  terminus: "終点 — 運行終了。",
  loading: "読み込み中…",
  runFinished: "この運行は終了しました。別の列車を選んでください。",
  noMoreServices: "本日の運行は終了しました。",
  dwellingAt: "停車中",
  departed: "発車済み",
  next: "次",
  closeInspector: "詳細を閉じる",
  closeStationBoard: "駅時刻表を閉じる",
  showPanel: "路線と表示設定を開く",
  hidePanel: "路線と表示設定を閉じる",
  engineError: "エンジンエラー",

  tourLabel: "ステップ",
  skip: "スキップ",
  back: "戻る",
  tourFinish: "使ってみる",
  tourWelcomeTitle: "ようこそ",
  tourWelcomeBody:
    "バンコク都市圏の鉄道網を 3D で — 10 路線、193 駅、1 日 8,193 運行。すべての列車が公表時刻表どおりに配置されます。このツアーでは各機能を順にハイライトします。いつでもスキップできます。",
  tourLinesTitle: "路線一覧",
  tourLinesBody:
    "この一覧は凡例であり、フィルターでもあります。路線をタップすると、その線路・駅・列車が非表示になります。シミュレーション自体は動き続けるので、本数や時刻表は正確なままです。",
  tourLabelsTitle: "地図に表示するもの",
  tourLabelsBody:
    "駅名はホームの上に浮かび、常にこちらを向きます。3D 建物は街に奥行きを与えます。オフにすれば低い角度から高架線が見え、非力な端末でも軽くなります。",
  tourUndergroundTitle: "地下を見る",
  tourUndergroundBody:
    "MRT ブルーラインは都心部を実際の深さ −18 m のトンネルで走ります。トンネル透視は、その地下線を上の建物越しに描きます。今オンなので、地図の中心をご覧ください。",
  tourLightingTitle: "昼と夜",
  tourLightingBody:
    "自動では、シミュレーション時刻に対する実際の太陽位置を計算するので、夜明けは夜明けらしく見えます。今は違いが分かるよう夜に切り替えています。ツアー終了後は自動に戻ります。",
  tourLanguageTitle: "言語",
  tourLanguageBody:
    "ひとつの設定で、画面・路線名・駅名のすべてがその言語だけになります。パーセントは、その言語で実際に名前が付いている駅の割合です（駅名は OpenStreetMap 由来のため）。",
  tourLocationTitle: "現在地",
  tourLocationBody:
    "自分の GPS 位置を地図に表示し、精度を円で示します。押すまで位置情報には一切アクセスせず、位置が端末の外に出ることもありません。",
  tourTimeTitle: "時刻バー",
  tourTimeBody:
    "バンコクの一日の任意の時刻までドラッグすると、路線網全体がその時刻の状態に切り替わります。ラッシュ時も終電も午前 3 時も、すべて再現されます。",
  tourWarpTitle: "速度と「現在」",
  tourWarpBody:
    "1× から 60× まで時間を早送りできます。60× なら一日の運行が約 24 分で流れます。「現在」を押すとバンコクの実時刻に戻ります。",
  tourTrainsTitle: "列車をタップ",
  tourTrainsBody:
    "地図上で動いている箱はどれも 1 本の運行です。タップすると行き先、カウントダウン付きの次駅、全区間の時刻表が見られ、三人称視点で追跡もできます。駅をタップすると発車標が開きます。",
  tourCameraTitle: "カメラ操作",
  tourCameraBody:
    "ドラッグで移動、スクロールでズーム。右ボタンまたは中ボタンを押しながらで旋回します。タッチでは 2 本指のひねりで回転、2 本指の上下ドラッグで傾きを変えられます。",
  tourHelpTitle: "ヘルプとデータ",
  tourHelpBody:
    "このボタンからいつでもツアーを開き直せます。データの出どころと、端末に何が保存されるかもここで確認できます。",
  tourDoneTitle: "以上です",
  tourDoneBody: "よい旅を。ツアーで変更した設定はすべて元に戻しました。",

  about: "このアプリについて",
  close: "閉じる",
  aboutBody:
    "バンコク都市圏 鉄道 3D は、この地域の鉄道網を 3D で表示し、公表されている静的時刻表をもとに実際の線形に沿って列車を動かします。実車位置の配信ではなく時刻表シミュレーションです。列車が「いるはずの場所」を示すため、任意の時刻に移動できます。",
  aboutData: "データ",
  aboutDataBody:
    "時刻表と駅座標は Namtang / OTP オープンデータの GTFS（CC-BY 4.0）。線形・駅名・その訳語は OpenStreetMap（ODbL）。ベースマップは OpenFreeMap です。",
  aboutPrivacy: "プライバシー",
  aboutPrivacyBody:
    "Cookie もアクセス解析もアカウントも、いかなる追跡もありません。保存されるのは表示設定だけです — 言語、表示する路線、上のスイッチ — 次回も同じ見た目になるよう、この端末に保存されます。「現在地」を使った場合も、位置は地図に描かれるだけで端末の外には出ません。",
  aboutProject: "プロジェクト",
  clearSettings: "設定を消去",
  support: "このプロジェクトを支援",
  supportBody:
    "無料・オープンソース・広告なしです。役に立ったと感じたら支援も歓迎します（任意です）。",
  sourceCode: "ソースコード",
  reportProblem: "問題を報告",
  replayTour: "ツアーをもう一度",
  stationNameCoverage:
    "この言語の駅名：{total} 駅中 {named} 駅。残りは英語で表示されます。駅名は OpenStreetMap 由来です。",
  planTrip:
    "経路を調べる",
  from:
    "出発",
  to:
    "到着",
  chooseStation:
    "駅を選ぶ",
  searchPlaceholder:
    "駅を検索 — どの言語でも、駅番号でも",
  noStationFound:
    "該当する駅がありません。",
  showOnMap:
    "地図で表示",
  noRouteFound:
    "この 2 駅を結ぶ経路が見つかりません。",
  sameStation:
    "同じ場所です。すでに着いています。",
  noChanges:
    "乗換なし",
  oneChange:
    "乗換 1 回",
  someChanges:
    "乗換 {n} 回",
  minutes:
    "分",
  changeHere:
    "ここで乗り換え",
  boardAt:
    "{station} から乗車",
  rideStops:
    "{n} 駅乗車",
  alightAt:
    "{station} で下車",
  plannerHint:
    "駅名をどの言語でも、または E4 のような駅番号で入力してください。現在地と目的地を選ぶと、乗る路線と乗換駅がわかります。",
  tourPlannerTitle: "目的地への行き方",
  tourPlannerBody:
    "バンコクは初めてですか？虫めがねをタップしてください。どの言語の駅名でも、駅番号でも検索できます。現在地と目的地を選べば、乗る路線・駅数・乗換場所がわかります。",
  copy:
    "コピー",
  copied:
    "コピーしました",
  promptPayQrAlt:
    "寄付用の PromptPay QR コード",
  promptPayVerify:
    "送金前に、コード下の番号が銀行アプリの表示と一致するか確認してください。",
};

const ko: Partial<Strings> = {
  appTitle: "방콕 광역 철도 3D",
  tapHint: "열차나 역을 탭하면 자세히 볼 수 있습니다.",
  loadingMap: "지도를 불러오는 중…",
  lines: "노선",
  trackOnly: "선로만",
  view: "보기",
  stationNames: "역 이름",
  seeThroughTunnels: "터널 투시",
  buildings: "3D 건물",
  shadows: "그림자",
  lighting: "조명",
  auto: "자동",
  day: "낮",
  night: "밤",
  nowDay: "현재 낮",
  nowNight: "현재 밤",
  language: "언어",
  myLocation: "내 위치",
  locating: "위치 찾는 중…",
  stopLocating: "위치 추적 중지",
  scrub: "시각",
  now: "지금",
  bangkok: "방콕",
  trains: "대",
  train: "대",
  station: "역",
  schedule: "시간표",
  nextDepartures: "다음 출발",
  interchange: "환승",
  followThisTrain: "이 열차 따라가기",
  following: "따라가는 중 — 탭하여 해제",
  terminus: "종착역 — 운행 종료.",
  loading: "불러오는 중…",
  runFinished: "이 운행은 종료되었습니다. 다른 열차를 선택하세요.",
  noMoreServices: "오늘 남은 운행이 없습니다.",
  dwellingAt: "정차 중",
  departed: "출발함",
  next: "다음",
  closeInspector: "상세 닫기",
  closeStationBoard: "역 시간표 닫기",
  showPanel: "노선 및 보기 옵션 열기",
  hidePanel: "노선 및 보기 옵션 닫기",
  engineError: "엔진 오류",

  tourLabel: "단계",
  skip: "건너뛰기",
  back: "이전",
  tourFinish: "시작하기",
  tourWelcomeTitle: "환영합니다",
  tourWelcomeBody:
    "방콕 광역권 철도망을 3D로 — 10개 노선, 193개 역, 하루 8,193회 운행. 모든 열차가 공개 시간표에 따라 배치됩니다. 이 안내는 기능을 하나씩 강조해 보여 줍니다. 언제든 건너뛸 수 있습니다.",
  tourLinesTitle: "노선 목록",
  tourLinesBody:
    "이 목록은 범례이자 필터입니다. 노선을 탭하면 그 선로와 역, 열차가 숨겨집니다. 시뮬레이션은 계속 돌아가므로 대수와 시간표는 그대로 정확합니다.",
  tourLabelsTitle: "지도에 표시할 것",
  tourLabelsBody:
    "역 이름은 승강장 위에 떠서 항상 정면을 향합니다. 3D 건물은 도시의 입체감을 살려 줍니다. 끄면 낮은 각도에서 고가 선로가 보이고, 사양이 낮은 기기에서도 가벼워집니다.",
  tourUndergroundTitle: "지하 들여다보기",
  tourUndergroundBody:
    "MRT 블루라인은 도심을 실제 −18 m 깊이의 터널로 지납니다. 터널 투시는 그 지하 선로를 위쪽 건물 너머로 그려 줍니다. 지금 켜져 있으니 지도 중앙을 보세요.",
  tourLightingTitle: "낮과 밤",
  tourLightingBody:
    "자동에서는 시뮬레이션 시각에 대한 실제 태양 위치를 계산하므로 새벽은 새벽처럼 보입니다. 차이를 보여 드리려고 지금은 밤으로 바꿔 두었고, 안내가 끝나면 자동으로 돌아갑니다.",
  tourLanguageTitle: "언어",
  tourLanguageBody:
    "설정 하나로 전부 바뀝니다 — 화면, 노선 이름, 역 이름 모두 그 언어만 표시됩니다. 퍼센트는 해당 언어로 실제 이름이 있는 역의 비율입니다(역 이름은 OpenStreetMap에서 옵니다).",
  tourLocationTitle: "내 위치",
  tourLocationBody:
    "내 GPS 위치를 지도에 표시하고 정확도를 원으로 보여 줍니다. 누르기 전에는 위치에 전혀 접근하지 않으며, 위치가 기기 밖으로 나가지 않습니다.",
  tourTimeTitle: "시간 막대",
  tourTimeBody:
    "방콕의 하루 중 어느 시각으로든 끌어 보세요. 전체 노선망이 그 시각의 상태로 이동합니다. 출퇴근 시간, 막차, 새벽 3시까지 전부 들어 있습니다.",
  tourWarpTitle: "속도와 ‘지금’",
  tourWarpBody:
    "1×에서 60×까지 시간을 빠르게 돌릴 수 있습니다. 60×면 하루 운행이 약 24분 만에 지나갑니다. ‘지금’을 누르면 방콕의 실제 시각으로 돌아옵니다.",
  tourTrainsTitle: "열차를 탭하세요",
  tourTrainsBody:
    "지도 위에서 움직이는 상자는 모두 한 번의 운행입니다. 탭하면 종착역, 실시간 카운트다운이 있는 다음 역, 전체 시간표를 볼 수 있고 3인칭으로 따라갈 수도 있습니다. 역을 탭하면 출발 안내가 열립니다.",
  tourCameraTitle: "카메라 조작",
  tourCameraBody:
    "끌어서 이동, 스크롤로 확대·축소. 마우스 오른쪽이나 가운데 버튼을 누른 채 움직이면 회전합니다. 터치에서는 두 손가락으로 비틀어 회전하고, 두 손가락을 위아래로 끌어 기울입니다.",
  tourHelpTitle: "도움말과 데이터",
  tourHelpBody:
    "이 버튼으로 언제든 안내를 다시 열 수 있고, 데이터 출처와 기기에 무엇이 저장되는지도 확인할 수 있습니다.",
  tourDoneTitle: "여기까지입니다",
  tourDoneBody: "즐겁게 둘러보세요. 안내 중 바꾼 설정은 모두 원래대로 되돌렸습니다.",

  about: "정보",
  close: "닫기",
  aboutBody:
    "방콕 광역 철도 3D는 이 지역의 철도망을 3D로 보여 주며, 공개된 정적 시간표를 바탕으로 실제 선형을 따라 열차를 움직입니다. 실시간 차량 신호가 아니라 시간표 시뮬레이션입니다. 열차가 '있어야 할' 위치를 보여 주기 때문에 아무 시각으로나 이동할 수 있습니다.",
  aboutData: "데이터",
  aboutDataBody:
    "시간표와 역 좌표는 Namtang / OTP 공개 데이터 GTFS(CC-BY 4.0)에서, 선형과 역 이름 및 번역은 OpenStreetMap(ODbL)에서 가져옵니다. 배경 지도는 OpenFreeMap입니다.",
  aboutPrivacy: "개인정보",
  aboutPrivacyBody:
    "쿠키도, 분석 도구도, 계정도, 어떤 형태의 추적도 없습니다. 저장되는 것은 보기 설정뿐입니다 — 언어, 표시할 노선, 위의 스위치 — 다음 방문에도 같도록 이 기기에 저장됩니다. '내 위치'를 사용해도 위치는 지도에 그려질 뿐 기기를 벗어나지 않습니다.",
  aboutProject: "프로젝트",
  clearSettings: "내 설정 지우기",
  support: "프로젝트 후원",
  supportBody:
    "무료이고 오픈소스이며 광고가 없습니다. 도움이 되었다면 후원도 환영합니다 — 전적으로 선택 사항입니다.",
  sourceCode: "소스 코드",
  reportProblem: "문제 신고",
  replayTour: "안내 다시 보기",
  stationNameCoverage:
    "이 언어의 역 이름: {total}개 중 {named}개. 나머지는 영어로 표시됩니다. 역 이름은 OpenStreetMap에서 옵니다.",
  planTrip:
    "경로 찾기",
  from:
    "출발",
  to:
    "도착",
  chooseStation:
    "역 선택",
  searchPlaceholder:
    "역 검색 — 어떤 언어로든, 역 번호로도",
  noStationFound:
    "일치하는 역이 없습니다.",
  showOnMap:
    "지도에서 보기",
  noRouteFound:
    "두 역을 잇는 경로를 찾지 못했습니다.",
  sameStation:
    "같은 장소입니다. 이미 도착해 있습니다.",
  noChanges:
    "환승 없음",
  oneChange:
    "환승 1회",
  someChanges:
    "환승 {n}회",
  minutes:
    "분",
  changeHere:
    "여기서 환승",
  boardAt:
    "{station}에서 승차",
  rideStops:
    "{n}개 역 이동",
  alightAt:
    "{station}에서 하차",
  plannerHint:
    "역 이름을 어떤 언어로든, 또는 E4 같은 번호로 입력하세요. 현재 위치와 목적지를 고르면 어떤 노선을 타고 어디서 갈아타는지 알려 줍니다.",
  tourPlannerTitle: "목적지까지 가는 법",
  tourPlannerBody:
    "방콕이 처음인가요? 돋보기를 누르세요. 어떤 언어의 역 이름으로도, 역 번호로도 검색할 수 있습니다. 현재 위치와 목적지를 고르면 어떤 노선을 타고 몇 정거장을 가서 어디서 갈아타는지 알려 줍니다.",
  copy:
    "복사",
  copied:
    "복사됨",
  promptPayQrAlt:
    "기부용 PromptPay QR 코드",
  promptPayVerify:
    "결제 전에 코드 아래 번호가 은행 앱에 표시된 번호와 같은지 확인하세요.",
};

const fr: Partial<Strings> = {
  appTitle: "Métro de Bangkok en 3D",
  tapHint: "Touchez un train ou une station pour l'inspecter.",
  loadingMap: "Chargement de la carte…",
  lines: "Lignes",
  trackOnly: "voie seule",
  view: "Affichage",
  stationNames: "Noms des stations",
  seeThroughTunnels: "Voir à travers les tunnels",
  buildings: "Bâtiments 3D",
  shadows: "Ombres",
  lighting: "Éclairage",
  auto: "Auto",
  day: "Jour",
  night: "Nuit",
  nowDay: "actuellement jour",
  nowNight: "actuellement nuit",
  language: "Langue",
  myLocation: "Ma position",
  locating: "Localisation…",
  stopLocating: "Arrêter la localisation",
  scrub: "Heure",
  now: "Maintenant",
  bangkok: "Bangkok",
  trains: "trains",
  train: "train",
  station: "Station",
  schedule: "Horaire",
  nextDepartures: "Prochains départs",
  interchange: "Correspondance",
  followThisTrain: "Suivre ce train",
  following: "Suivi — touchez pour arrêter",
  terminus: "Terminus — fin du trajet.",
  loading: "Chargement…",
  runFinished: "Ce trajet est terminé. Choisissez un autre train.",
  noMoreServices: "Plus aucun service prévu aujourd'hui.",
  dwellingAt: "À l'arrêt à",
  departed: "Parti de",
  next: "Prochaine",
  closeInspector: "Fermer le panneau",
  closeStationBoard: "Fermer les horaires de la station",
  showPanel: "Afficher les lignes et options",
  hidePanel: "Masquer les lignes et options",
  engineError: "Erreur du moteur",

  tourLabel: "Étape",
  skip: "Passer",
  back: "Retour",
  tourFinish: "Commencer",
  tourWelcomeTitle: "Bienvenue à bord",
  tourWelcomeBody:
    "Le réseau ferré du Grand Bangkok en 3D — 10 lignes, 193 stations, 8 193 circulations par jour, chaque train placé selon l'horaire publié. Cette visite met en évidence chaque commande. Vous pouvez passer à tout moment.",
  tourLinesTitle: "Les lignes",
  tourLinesBody:
    "Cette liste sert à la fois de légende et de filtre. Touchez une ligne pour masquer sa voie, ses stations et ses trains. La simulation continue en arrière-plan : les compteurs et les horaires restent justes.",
  tourLabelsTitle: "Ce qui est affiché",
  tourLabelsBody:
    "Les noms de station flottent au-dessus des quais et vous font toujours face. Les bâtiments 3D donnent du relief à la ville ; désactivez-les pour voir les voies aériennes de profil, ou pour alléger l'affichage.",
  tourUndergroundTitle: "Voir sous terre",
  tourUndergroundBody:
    "La ligne bleue du MRT traverse le centre en tunnel, à −18 m réels. « Voir à travers les tunnels » dessine cette voie enterrée au travers des bâtiments. C'est activé : regardez le centre de la carte.",
  tourLightingTitle: "Jour et nuit",
  tourLightingBody:
    "En mode Auto, la position du soleil est calculée pour l'heure simulée : l'aube ressemble à l'aube. Le mode Nuit est activé pour la démonstration ; Auto revient à la fin de la visite.",
  tourLanguageTitle: "Votre langue",
  tourLanguageBody:
    "Un seul réglage change tout — interface, noms de lignes et de stations — dans cette langue uniquement. Le pourcentage indique la part du réseau réellement nommée dans cette langue, les noms venant d'OpenStreetMap.",
  tourLocationTitle: "Où vous êtes",
  tourLocationBody:
    "Affiche votre position GPS sur la carte, avec un cercle indiquant la précision. Rien n'accède à votre position avant que vous n'appuyiez, et elle ne quitte jamais votre appareil.",
  tourTimeTitle: "L'heure",
  tourTimeBody:
    "Faites glisser jusqu'à n'importe quel moment de la journée bangkokoise : tout le réseau se replace en conséquence. Heure de pointe, dernier train, trois heures du matin — tout y est.",
  tourWarpTitle: "Vitesse et « Maintenant »",
  tourWarpBody:
    "Faites défiler le temps de 1× à 60×. À 60×, une journée entière passe en vingt-quatre minutes environ. « Maintenant » ramène l'horloge à l'heure réelle de Bangkok.",
  tourTrainsTitle: "Touchez un train",
  tourTrainsBody:
    "Chaque boîte en mouvement est une circulation. Touchez-la pour sa destination, son prochain arrêt avec compte à rebours et son horaire complet — puis suivez-la à la troisième personne. Toucher une station ouvre ses départs.",
  tourCameraTitle: "Déplacer la caméra",
  tourCameraBody:
    "Glissez pour déplacer, molette pour zoomer. Maintenez le bouton droit ou central pour pivoter. Sur écran tactile, pivotez à deux doigts et faites glisser deux doigts verticalement pour incliner.",
  tourHelpTitle: "Aide et données",
  tourHelpBody:
    "Ce bouton rouvre la visite à tout moment et explique d'où viennent les données et ce qui est stocké sur votre appareil.",
  tourDoneTitle: "C'est tout",
  tourDoneBody: "Bonne route. Tous les réglages modifiés pendant la visite ont été rétablis.",

  about: "À propos",
  close: "Fermer",
  aboutBody:
    "Métro de Bangkok en 3D affiche le réseau ferré de la région en trois dimensions, en animant les trains le long du tracé réel à partir d'horaires statiques publiés. C'est une simulation d'horaires, pas un flux temps réel : elle montre où les trains sont censés être, d'où la possibilité de se déplacer à n'importe quelle heure.",
  aboutData: "Données",
  aboutDataBody:
    "Horaires et coordonnées des stations : jeu GTFS en données ouvertes Namtang / OTP (CC-BY 4.0). Tracé, noms de stations et traductions : OpenStreetMap (ODbL). Fond de carte : OpenFreeMap.",
  aboutPrivacy: "Confidentialité",
  aboutPrivacyBody:
    "Aucun cookie, aucune mesure d'audience, aucun compte, aucun suivi. Seuls vos réglages d'affichage sont conservés — langue, lignes affichées, interrupteurs ci-dessus — sur cet appareil, pour retrouver la même vue à votre prochaine visite. Si vous utilisez « Ma position », elle est dessinée sur la carte et ne quitte jamais votre appareil.",
  aboutProject: "Projet",
  clearSettings: "Oublier mes réglages",
  support: "Soutenir ce projet",
  supportBody:
    "Gratuit, open source et sans publicité. S'il vous est utile, vous pouvez contribuer — c'est entièrement facultatif.",
  sourceCode: "Code source",
  reportProblem: "Signaler un problème",
  replayTour: "Revoir la visite",
  stationNameCoverage:
    "Noms de stations dans cette langue : {named} sur {total}. Les autres passent à l’anglais. Les noms viennent d’OpenStreetMap.",
  planTrip:
    "Planifier un trajet",
  from:
    "De",
  to:
    "À",
  chooseStation:
    "Choisir une station",
  searchPlaceholder:
    "Rechercher une station — toute langue, ou son code",
  noStationFound:
    "Aucune station ne correspond.",
  showOnMap:
    "Afficher sur la carte",
  noRouteFound:
    "Aucun itinéraire entre ces deux stations.",
  sameStation:
    "C’est le même endroit — vous y êtes déjà.",
  noChanges:
    "sans correspondance",
  oneChange:
    "1 correspondance",
  someChanges:
    "{n} correspondances",
  minutes:
    "min",
  changeHere:
    "Changer ici",
  boardAt:
    "Montez à {station}",
  rideStops:
    "Parcourez {n} stations",
  alightAt:
    "descendez à {station}",
  plannerHint:
    "Tapez un nom de station dans n’importe quelle langue, ou son code comme E4. Choisissez où vous êtes puis où vous allez : vous saurez quelle ligne prendre et où changer.",
  tourPlannerTitle: "Aller quelque part",
  tourPlannerBody:
    "Vous arrivez à Bangkok ? Touchez la loupe. Cherchez une station par son nom — dans n’importe quelle langue — ou par son code, puis choisissez où vous êtes et où vous allez. Vous obtenez la ligne à prendre, le nombre d’arrêts et où changer.",
  copy:
    "Copier",
  copied:
    "Copié",
  promptPayQrAlt:
    "QR code PromptPay pour les dons",
  promptPayVerify:
    "Vérifiez le numéro sous le code avant de payer : il doit correspondre à celui de votre application bancaire.",
};

const de: Partial<Strings> = {
  appTitle: "Bangkok Nahverkehr in 3D",
  tapHint: "Tippen Sie auf einen Zug oder Bahnhof für Details.",
  loadingMap: "Karte wird geladen…",
  lines: "Linien",
  trackOnly: "nur Gleis",
  view: "Ansicht",
  stationNames: "Stationsnamen",
  seeThroughTunnels: "Durch Tunnel sehen",
  buildings: "3D-Gebäude",
  shadows: "Schatten",
  lighting: "Beleuchtung",
  auto: "Auto",
  day: "Tag",
  night: "Nacht",
  nowDay: "derzeit Tag",
  nowNight: "derzeit Nacht",
  language: "Sprache",
  myLocation: "Mein Standort",
  locating: "Standort wird ermittelt…",
  stopLocating: "Standortsuche beenden",
  scrub: "Zeit",
  now: "Jetzt",
  bangkok: "Bangkok",
  trains: "Züge",
  train: "Zug",
  station: "Station",
  schedule: "Fahrplan",
  nextDepartures: "Nächste Abfahrten",
  interchange: "Umstieg",
  followThisTrain: "Diesem Zug folgen",
  following: "Folgt — tippen zum Lösen",
  terminus: "Endstation — Fahrt beendet.",
  loading: "Wird geladen…",
  runFinished: "Diese Fahrt ist beendet. Wählen Sie einen anderen Zug.",
  noMoreServices: "Heute keine weiteren Fahrten.",
  dwellingAt: "Hält in",
  departed: "Abgefahren von",
  next: "Nächste",
  closeInspector: "Detailfenster schließen",
  closeStationBoard: "Stationsfahrplan schließen",
  showPanel: "Linien und Ansicht einblenden",
  hidePanel: "Linien und Ansicht ausblenden",
  engineError: "Engine-Fehler",

  tourLabel: "Schritt",
  skip: "Überspringen",
  back: "Zurück",
  tourFinish: "Loslegen",
  tourWelcomeTitle: "Willkommen an Bord",
  tourWelcomeBody:
    "Das Schienennetz des Großraums Bangkok in 3D — 10 Linien, 193 Stationen, 8.193 Fahrten pro Tag, jeder Zug nach veröffentlichtem Fahrplan platziert. Diese Tour hebt jede Funktion einzeln hervor. Jederzeit überspringbar.",
  tourLinesTitle: "Die Linien",
  tourLinesBody:
    "Diese Liste ist Legende und Filter zugleich. Tippen Sie eine Linie an, um Gleis, Stationen und Züge auszublenden. Die Simulation läuft weiter, Zählwerte und Fahrpläne bleiben also korrekt.",
  tourLabelsTitle: "Was gezeichnet wird",
  tourLabelsBody:
    "Stationsnamen schweben über den Bahnsteigen und zeigen immer zu Ihnen. 3D-Gebäude geben der Stadt Tiefe — ausschalten, um Hochbahnstrecken flach von der Seite zu sehen oder auf schwächeren Geräten flüssiger zu bleiben.",
  tourUndergroundTitle: "Unter die Erde schauen",
  tourUndergroundBody:
    "Die MRT-Blaulinie fährt im Stadtkern in echten −18 m Tiefe im Tunnel. „Durch Tunnel sehen“ zeichnet diese Strecke durch die Gebäude darüber. Es ist gerade an — schauen Sie in die Kartenmitte.",
  tourLightingTitle: "Tag und Nacht",
  tourLightingBody:
    "Bei Auto wird der Sonnenstand für die simulierte Zeit echt berechnet, die Dämmerung sieht also aus wie Dämmerung. Zur Demonstration ist Nacht aktiv; nach der Tour kehrt Auto zurück.",
  tourLanguageTitle: "Ihre Sprache",
  tourLanguageBody:
    "Eine Einstellung ändert alles — Oberfläche, Linien- und Stationsnamen — und zwar nur in dieser Sprache. Der Prozentwert zeigt, wie viel des Netzes in dieser Sprache tatsächlich benannt ist; die Namen stammen aus OpenStreetMap.",
  tourLocationTitle: "Ihr Standort",
  tourLocationBody:
    "Zeigt Ihre GPS-Position auf der Karte, mit einem Kreis für die Genauigkeit. Vor dem Antippen wird der Standort nicht abgefragt, und er verlässt Ihr Gerät nie.",
  tourTimeTitle: "Die Uhr",
  tourTimeBody:
    "Ziehen Sie zu einem beliebigen Zeitpunkt des Bangkoker Tages — das gesamte Netz springt dorthin. Hauptverkehrszeit, letzter Zug, drei Uhr nachts: alles vorhanden.",
  tourWarpTitle: "Tempo und „Jetzt“",
  tourWarpBody:
    "Die Zeit läuft mit 1× bis 60×. Bei 60× vergeht ein ganzer Betriebstag in etwa vierundzwanzig Minuten. „Jetzt“ holt die Uhr zurück auf die echte Zeit in Bangkok.",
  tourTrainsTitle: "Auf einen Zug tippen",
  tourTrainsBody:
    "Jede bewegte Box ist eine Fahrt. Tippen Sie darauf für Ziel, nächsten Halt mit laufendem Countdown und den vollen Fahrplan — und folgen Sie ihr in der Verfolgeransicht. Ein Tipp auf eine Station öffnet deren Abfahrtstafel.",
  tourCameraTitle: "Kamera bewegen",
  tourCameraBody:
    "Ziehen zum Verschieben, Scrollen zum Zoomen. Zum Drehen die rechte oder mittlere Maustaste halten. Auf dem Touchscreen mit zwei Fingern drehen und zwei Finger auf und ab ziehen zum Neigen.",
  tourHelpTitle: "Hilfe und Daten",
  tourHelpBody:
    "Über diese Schaltfläche öffnen Sie die Tour jederzeit erneut; dort steht auch, woher die Daten stammen und was auf Ihrem Gerät gespeichert wird.",
  tourDoneTitle: "Das war alles",
  tourDoneBody: "Gute Fahrt. Alle für die Tour geänderten Einstellungen sind zurückgesetzt.",

  about: "Über",
  close: "Schließen",
  aboutBody:
    "Bangkok Nahverkehr in 3D zeigt das Schienennetz der Region dreidimensional und bewegt Züge anhand veröffentlichter statischer Fahrpläne entlang der echten Streckenführung. Es ist eine Fahrplansimulation, kein Echtzeit-Fahrzeugsignal: Sie zeigt, wo Züge sein sollten — deshalb lässt sich zu jeder Tageszeit springen.",
  aboutData: "Daten",
  aboutDataBody:
    "Fahrpläne und Stationskoordinaten stammen aus dem offenen GTFS-Datensatz von Namtang / OTP (CC-BY 4.0). Streckenführung, Stationsnamen und Übersetzungen aus OpenStreetMap (ODbL). Grundkarte: OpenFreeMap.",
  aboutPrivacy: "Datenschutz",
  aboutPrivacyBody:
    "Keine Cookies, keine Analyse, keine Konten, kein Tracking jeglicher Art. Gespeichert werden nur Ihre Ansichtseinstellungen — Sprache, sichtbare Linien, die Schalter oben — auf diesem Gerät, damit beim nächsten Besuch alles gleich aussieht. Bei „Mein Standort“ wird Ihre Position nur auf der Karte gezeichnet und verlässt Ihr Gerät nicht.",
  aboutProject: "Projekt",
  clearSettings: "Einstellungen vergessen",
  support: "Dieses Projekt unterstützen",
  supportBody:
    "Kostenlos, quelloffen und werbefrei. Wenn es Ihnen nützt, können Sie gern etwas beisteuern — völlig freiwillig.",
  sourceCode: "Quellcode",
  reportProblem: "Problem melden",
  replayTour: "Tour erneut ansehen",
  stationNameCoverage:
    "Stationsnamen in dieser Sprache: {named} von {total}. Der Rest fällt auf Englisch zurück. Namen stammen aus OpenStreetMap.",
  planTrip:
    "Route planen",
  from:
    "Von",
  to:
    "Nach",
  chooseStation:
    "Station wählen",
  searchPlaceholder:
    "Station suchen — in jeder Sprache oder per Code",
  noStationFound:
    "Keine passende Station.",
  showOnMap:
    "Auf der Karte zeigen",
  noRouteFound:
    "Zwischen diesen beiden gibt es keine Verbindung.",
  sameStation:
    "Das ist derselbe Ort — Sie sind schon da.",
  noChanges:
    "ohne Umstieg",
  oneChange:
    "1 Umstieg",
  someChanges:
    "{n} Umstiege",
  minutes:
    "Min",
  changeHere:
    "Hier umsteigen",
  boardAt:
    "In {station} einsteigen",
  rideStops:
    "{n} Stationen fahren",
  alightAt:
    "in {station} aussteigen",
  plannerHint:
    "Geben Sie einen Stationsnamen in beliebiger Sprache ein oder einen Code wie E4. Wählen Sie, wo Sie sind und wohin Sie wollen — Sie erfahren, welche Linie und wo Sie umsteigen.",
  tourPlannerTitle: "Irgendwo hinkommen",
  tourPlannerBody:
    "Neu in Bangkok? Tippen Sie auf die Lupe. Suchen Sie eine Station nach Namen — in jeder Sprache — oder nach Code, und wählen Sie dann Start und Ziel. Sie erfahren die Linie, die Zahl der Stationen und wo Sie umsteigen.",
  copy:
    "Kopieren",
  copied:
    "Kopiert",
  promptPayQrAlt:
    "PromptPay-QR-Code für Spenden",
  promptPayVerify:
    "Prüfen Sie vor dem Bezahlen die Nummer unter dem Code — sie muss der in Ihrer Banking-App entsprechen.",
};

const ru: Partial<Strings> = {
  appTitle: "Метро Бангкока в 3D",
  tapHint: "Нажмите на поезд или станцию, чтобы посмотреть детали.",
  loadingMap: "Загрузка карты…",
  lines: "Линии",
  trackOnly: "только пути",
  view: "Вид",
  stationNames: "Названия станций",
  seeThroughTunnels: "Видеть сквозь тоннели",
  buildings: "3D-здания",
  shadows: "Тени",
  lighting: "Освещение",
  auto: "Авто",
  day: "День",
  night: "Ночь",
  nowDay: "сейчас день",
  nowNight: "сейчас ночь",
  language: "Язык",
  myLocation: "Моё местоположение",
  locating: "Определение местоположения…",
  stopLocating: "Остановить определение",
  scrub: "Время",
  now: "Сейчас",
  bangkok: "Бангкок",
  trains: "поездов",
  train: "поезд",
  station: "Станция",
  schedule: "Расписание",
  nextDepartures: "Ближайшие отправления",
  interchange: "Пересадка",
  followThisTrain: "Следовать за поездом",
  following: "Следование — нажмите, чтобы отменить",
  terminus: "Конечная — рейс завершён.",
  loading: "Загрузка…",
  runFinished: "Этот рейс завершён. Выберите другой поезд.",
  noMoreServices: "Сегодня рейсов больше нет.",
  dwellingAt: "Стоит на",
  departed: "Отправился от",
  next: "Следующая",
  closeInspector: "Закрыть панель",
  closeStationBoard: "Закрыть расписание станции",
  showPanel: "Показать линии и настройки вида",
  hidePanel: "Скрыть линии и настройки вида",
  engineError: "Ошибка движка",

  tourLabel: "Шаг",
  skip: "Пропустить",
  back: "Назад",
  tourFinish: "Начать",
  tourWelcomeTitle: "Добро пожаловать",
  tourWelcomeBody:
    "Рельсовая сеть Большого Бангкока в 3D — 10 линий, 193 станции, 8193 рейса в сутки, каждый поезд размещён по опубликованному расписанию. Этот тур по очереди подсвечивает каждый элемент. Пропустить можно в любой момент.",
  tourLinesTitle: "Линии",
  tourLinesBody:
    "Этот список одновременно легенда и фильтр. Нажмите на линию, чтобы скрыть её пути, станции и поезда. Симуляция продолжает работать, поэтому счётчики и расписания остаются верными.",
  tourLabelsTitle: "Что отображается",
  tourLabelsBody:
    "Названия станций висят над платформами и всегда повёрнуты к вам. 3D-здания придают городу объём; выключите их, чтобы разглядеть эстакады сбоку или ускорить работу на слабом устройстве.",
  tourUndergroundTitle: "Заглянуть под землю",
  tourUndergroundBody:
    "Синяя линия MRT проходит через центр в тоннеле на реальной глубине −18 м. Режим «сквозь тоннели» рисует подземный путь поверх зданий. Сейчас он включён — посмотрите на центр карты.",
  tourLightingTitle: "День и ночь",
  tourLightingBody:
    "В режиме «Авто» положение солнца рассчитывается по симулируемому времени, поэтому рассвет выглядит рассветом. Сейчас включена «Ночь» для наглядности; после тура вернётся «Авто».",
  tourLanguageTitle: "Ваш язык",
  tourLanguageBody:
    "Одна настройка меняет всё — интерфейс, названия линий и станций — только на этот язык. Процент показывает, для какой доли сети есть названия на этом языке: они берутся из OpenStreetMap.",
  tourLocationTitle: "Где вы находитесь",
  tourLocationBody:
    "Показывает вашу GPS-позицию на карте и круг точности. До нажатия к геолокации нет обращений, и позиция никогда не покидает устройство.",
  tourTimeTitle: "Часы",
  tourTimeBody:
    "Перетащите на любой момент бангкокских суток — вся сеть перейдёт в состояние на это время. Час пик, последний поезд, три часа ночи — всё на месте.",
  tourWarpTitle: "Скорость и «Сейчас»",
  tourWarpBody:
    "Время идёт от 1× до 60×. На 60× целые сутки движения проходят примерно за двадцать четыре минуты. «Сейчас» возвращает часы к реальному времени Бангкока.",
  tourTrainsTitle: "Нажмите на поезд",
  tourTrainsBody:
    "Каждый движущийся прямоугольник — это один рейс. Нажмите, чтобы увидеть конечную, следующую остановку с обратным отсчётом и всё расписание, а затем следовать за ним от третьего лица. Нажатие на станцию открывает её табло.",
  tourCameraTitle: "Управление камерой",
  tourCameraBody:
    "Перетаскивание — сдвиг, колесо — масштаб. Для облёта удерживайте правую или среднюю кнопку мыши. На сенсорном экране поворачивайте двумя пальцами и тяните двумя пальцами вверх-вниз для наклона.",
  tourHelpTitle: "Справка и данные",
  tourHelpBody:
    "Эта кнопка в любой момент снова откроет тур, а также объяснит, откуда берутся данные и что именно хранится на вашем устройстве.",
  tourDoneTitle: "Это всё",
  tourDoneBody: "Приятной поездки. Все изменённые во время тура настройки возвращены обратно.",

  about: "О проекте",
  close: "Закрыть",
  aboutBody:
    "«Метро Бангкока в 3D» показывает рельсовую сеть региона в трёх измерениях, двигая поезда по реальной геометрии путей на основе опубликованных статических расписаний. Это симуляция расписания, а не поток данных о реальных поездах: она показывает, где поезда должны быть, — поэтому можно перейти к любому времени суток.",
  aboutData: "Данные",
  aboutDataBody:
    "Расписания и координаты станций — из открытого набора GTFS Namtang / OTP (CC-BY 4.0). Геометрия путей, названия станций и переводы — из OpenStreetMap (ODbL). Подложка — OpenFreeMap.",
  aboutPrivacy: "Приватность",
  aboutPrivacyBody:
    "Никаких cookie, аналитики, учётных записей и слежки. Сохраняются только настройки отображения — язык, показанные линии, переключатели выше — на этом устройстве, чтобы при следующем визите всё выглядело так же. При использовании «Моего местоположения» позиция лишь рисуется на карте и не покидает устройство.",
  aboutProject: "Проект",
  clearSettings: "Забыть мои настройки",
  support: "Поддержать проект",
  supportBody:
    "Бесплатно, с открытым кодом и без рекламы. Если проект вам полезен, можно поддержать — исключительно по желанию.",
  sourceCode: "Исходный код",
  reportProblem: "Сообщить о проблеме",
  replayTour: "Пройти тур заново",
  stationNameCoverage:
    "Названия станций на этом языке: {named} из {total}. Остальные показываются по-английски. Названия из OpenStreetMap.",
  planTrip:
    "Построить маршрут",
  from:
    "Откуда",
  to:
    "Куда",
  chooseStation:
    "Выберите станцию",
  searchPlaceholder:
    "Поиск станции — на любом языке или по коду",
  noStationFound:
    "Подходящей станции нет.",
  showOnMap:
    "Показать на карте",
  noRouteFound:
    "Между этими станциями маршрут не найден.",
  sameStation:
    "Это одно и то же место — вы уже там.",
  noChanges:
    "без пересадок",
  oneChange:
    "1 пересадка",
  someChanges:
    "пересадок: {n}",
  minutes:
    "мин",
  changeHere:
    "Пересадка здесь",
  boardAt:
    "Сесть на {station}",
  rideStops:
    "Проехать {n} станций",
  alightAt:
    "выйти на {station}",
  plannerHint:
    "Введите название станции на любом языке или код вроде E4. Выберите, где вы сейчас и куда едете, — и увидите, на какую линию садиться и где пересаживаться.",
  tourPlannerTitle: "Как добраться",
  tourPlannerBody:
    "Впервые в Бангкоке? Нажмите на лупу. Найдите станцию по названию на любом языке или по коду, затем укажите, где вы и куда едете. Вы увидите линию, число остановок и место пересадки.",
  copy:
    "Копировать",
  copied:
    "Скопировано",
  promptPayQrAlt:
    "QR-код PromptPay для пожертвований",
  promptPayVerify:
    "Перед оплатой сверьте номер под кодом с тем, что показывает банковское приложение.",
};

const es: Partial<Strings> = {
  appTitle: "Metro de Bangkok en 3D",
  tapHint: "Toca un tren o una estación para ver los detalles.",
  loadingMap: "Cargando el mapa…",
  lines: "Líneas",
  trackOnly: "solo vía",
  view: "Vista",
  stationNames: "Nombres de estaciones",
  seeThroughTunnels: "Ver a través de los túneles",
  buildings: "Edificios 3D",
  shadows: "Sombras",
  lighting: "Iluminación",
  auto: "Auto",
  day: "Día",
  night: "Noche",
  nowDay: "ahora de día",
  nowNight: "ahora de noche",
  language: "Idioma",
  myLocation: "Mi ubicación",
  locating: "Localizando…",
  stopLocating: "Detener localización",
  scrub: "Hora",
  now: "Ahora",
  bangkok: "Bangkok",
  trains: "trenes",
  train: "tren",
  station: "Estación",
  schedule: "Horario",
  nextDepartures: "Próximas salidas",
  interchange: "Transbordo",
  followThisTrain: "Seguir este tren",
  following: "Siguiendo — toca para soltar",
  terminus: "Terminal — fin del recorrido.",
  loading: "Cargando…",
  runFinished: "Este recorrido ha terminado. Elige otro tren.",
  noMoreServices: "No hay más servicios programados hoy.",
  dwellingAt: "Detenido en",
  departed: "Salió de",
  next: "Siguiente",
  closeInspector: "Cerrar el panel",
  closeStationBoard: "Cerrar horarios de la estación",
  showPanel: "Mostrar líneas y opciones de vista",
  hidePanel: "Ocultar líneas y opciones de vista",
  engineError: "Error del motor",

  tourLabel: "Paso",
  skip: "Omitir",
  back: "Atrás",
  tourFinish: "Empezar",
  tourWelcomeTitle: "Bienvenido a bordo",
  tourWelcomeBody:
    "La red ferroviaria del Gran Bangkok en 3D: 10 líneas, 193 estaciones, 8.193 circulaciones al día, cada tren situado según su horario publicado. Este recorrido resalta cada control por turno. Puedes omitirlo cuando quieras.",
  tourLinesTitle: "Las líneas",
  tourLinesBody:
    "Esta lista es a la vez leyenda y filtro. Toca una línea para ocultar su vía, sus estaciones y sus trenes. La simulación sigue corriendo por debajo, así que los recuentos y horarios siguen siendo fieles.",
  tourLabelsTitle: "Qué se dibuja",
  tourLabelsBody:
    "Los nombres de estación flotan sobre los andenes y siempre te miran de frente. Los edificios 3D dan profundidad a la ciudad; desactívalos para ver la vía elevada desde un ángulo bajo o para ganar fluidez.",
  tourUndergroundTitle: "Mirar bajo tierra",
  tourUndergroundBody:
    "La línea azul del MRT cruza el centro en túnel, a −18 m reales. «Ver a través de los túneles» dibuja esa vía enterrada por encima de los edificios. Está activado: mira el centro del mapa.",
  tourLightingTitle: "Día y noche",
  tourLightingBody:
    "En Auto, el sol se sitúa con un cálculo solar real para la hora simulada, así que el amanecer parece un amanecer. Ahora está en Noche para que veas la diferencia; Auto vuelve al terminar.",
  tourLanguageTitle: "Tu idioma",
  tourLanguageBody:
    "Un solo ajuste lo cambia todo — interfaz, nombres de líneas y de estaciones — y solo en ese idioma. El porcentaje indica cuánta parte de la red tiene nombre real en ese idioma, ya que los nombres vienen de OpenStreetMap.",
  tourLocationTitle: "Dónde estás",
  tourLocationBody:
    "Muestra tu posición GPS en el mapa, con un círculo que indica la precisión. Nada accede a tu ubicación hasta que pulses, y tu posición nunca sale de tu dispositivo.",
  tourTimeTitle: "El reloj",
  tourTimeBody:
    "Arrastra a cualquier momento del día en Bangkok y toda la red salta a como debería estar entonces. Hora punta, último tren, las tres de la madrugada: está todo.",
  tourWarpTitle: "Velocidad y «Ahora»",
  tourWarpBody:
    "El tiempo corre de 1× a 60×. A 60×, una jornada completa pasa en unos veinticuatro minutos. «Ahora» devuelve el reloj a la hora real de Bangkok.",
  tourTrainsTitle: "Toca un tren",
  tourTrainsBody:
    "Cada caja en movimiento es una circulación. Tócala para ver su destino, su próxima parada con cuenta atrás y su horario completo, y luego síguela en tercera persona. Al tocar una estación se abre su panel de salidas.",
  tourCameraTitle: "Mover la cámara",
  tourCameraBody:
    "Arrastra para desplazar y usa la rueda para acercar. Mantén el botón derecho o central para orbitar. En pantalla táctil, gira con dos dedos y arrastra dos dedos arriba o abajo para inclinar.",
  tourHelpTitle: "Ayuda y datos",
  tourHelpBody:
    "Este botón vuelve a abrir el recorrido cuando quieras y explica de dónde vienen los datos y qué se guarda exactamente en tu dispositivo.",
  tourDoneTitle: "Eso es todo",
  tourDoneBody: "Buen viaje. Todo lo que se cambió durante el recorrido ha vuelto a su estado.",

  about: "Acerca de",
  close: "Cerrar",
  aboutBody:
    "Metro de Bangkok en 3D muestra la red ferroviaria de la región en tres dimensiones, animando los trenes a lo largo del trazado real a partir de horarios estáticos publicados. Es una simulación de horarios, no una señal de vehículos en tiempo real: muestra dónde deberían estar los trenes, y por eso puedes saltar a cualquier hora del día.",
  aboutData: "Datos",
  aboutDataBody:
    "Los horarios y las coordenadas de estación provienen del conjunto GTFS de datos abiertos Namtang / OTP (CC-BY 4.0). El trazado, los nombres de estación y sus traducciones, de OpenStreetMap (ODbL). El mapa base es OpenFreeMap.",
  aboutPrivacy: "Privacidad",
  aboutPrivacyBody:
    "Sin cookies, sin analíticas, sin cuentas, sin seguimiento de ningún tipo. Lo único que se guarda son tus ajustes de vista — idioma, líneas mostradas, los interruptores de arriba — en este dispositivo, para que todo se vea igual en tu próxima visita. Si usas «Mi ubicación», tu posición se dibuja en el mapa y nunca sale de tu dispositivo.",
  aboutProject: "Proyecto",
  clearSettings: "Olvidar mis ajustes",
  support: "Apoyar este proyecto",
  supportBody:
    "Es gratuito, de código abierto y sin anuncios. Si te resulta útil, puedes contribuir — totalmente opcional.",
  sourceCode: "Código fuente",
  reportProblem: "Informar de un problema",
  replayTour: "Ver el recorrido otra vez",
  stationNameCoverage:
    "Nombres de estaciones en este idioma: {named} de {total}. El resto pasa al inglés. Los nombres vienen de OpenStreetMap.",
  planTrip:
    "Planificar viaje",
  from:
    "Desde",
  to:
    "Hasta",
  chooseStation:
    "Elige una estación",
  searchPlaceholder:
    "Buscar estación — en cualquier idioma o por su código",
  noStationFound:
    "Ninguna estación coincide.",
  showOnMap:
    "Ver en el mapa",
  noRouteFound:
    "No hay ruta entre esas dos.",
  sameStation:
    "Es el mismo sitio: ya estás allí.",
  noChanges:
    "sin transbordos",
  oneChange:
    "1 transbordo",
  someChanges:
    "{n} transbordos",
  minutes:
    "min",
  changeHere:
    "Haz transbordo aquí",
  boardAt:
    "Sube en {station}",
  rideStops:
    "Viaja {n} estaciones",
  alightAt:
    "baja en {station}",
  plannerHint:
    "Escribe el nombre de una estación en cualquier idioma, o su código como E4. Elige dónde estás y a dónde vas, y sabrás qué línea tomar y dónde cambiar.",
  tourPlannerTitle: "Cómo llegar",
  tourPlannerBody:
    "¿Recién llegado a Bangkok? Toca la lupa. Busca una estación por su nombre —en cualquier idioma— o por su código, y luego elige dónde estás y a dónde vas. Sabrás qué línea tomar, cuántas paradas y dónde cambiar.",
  copy:
    "Copiar",
  copied:
    "Copiado",
  promptPayQrAlt:
    "Código QR de PromptPay para donaciones",
  promptPayVerify:
    "Antes de pagar, comprueba que el número bajo el código coincida con el de tu app bancaria.",
};

/**
 * Translations may be PARTIAL. `en` is the only table the compiler forces to
 * be complete; every other language is `Partial<Strings>` and any missing key
 * falls back to English per key, not per language.
 *
 * That matters because the app's copy grows. Requiring every language to be
 * complete before a feature could ship would either block the feature or fill
 * nine tables with guessed translations. Falling back per key means a reader
 * keeps their language and sees only the newest string in English until it is
 * translated — visible, honest, and fixable one line at a time.
 *
 * All nine tables are currently complete; `tools/i18n.test.mjs` keeps them
 * that way by failing on any key that has silently fallen behind.
 */
export const STRINGS: { en: Strings } & Record<string, Partial<Strings>> = {
  en,
  th,
  zh,
  ja,
  ko,
  fr,
  de,
  ru,
  es,
};

/** Which languages have a table at all. */
export const TRANSLATED_LANGUAGES = Object.keys(STRINGS);

const merged = new Map<string, Strings>();

/** Strings for `language`, with English filling any gaps. */
export function stringsFor(language: string): Strings {
  const cached = merged.get(language);
  if (cached) return cached;
  const table = STRINGS[language];
  // English first so a present translation wins; a Partial simply omits a key
  // rather than carrying `undefined`, so nothing can overwrite with a blank.
  const result: Strings = table ? { ...en, ...table } : en;
  merged.set(language, result);
  return result;
}
