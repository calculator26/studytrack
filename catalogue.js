/* =========================================================================
   HSC CATALOGUE — Knox Grammar subject list, 2026 cohort
   -------------------------------------------------------------------------
   Every subject Knox has presented at the HSC, with:
     · exams  — every written paper, hard-coded from the official NESA
                "2026 HSC written examination timetable" (version 01-05-26).
     · areas  — the sections/modules the course is actually built from,
                taken from the NESA Stage 6 syllabus and exam specifications.

   This is a STARTING POINT, not a rule. Everything it fills in — the name,
   the colour, the exam date, every area — is editable, removable and
   addable-to in the app afterwards. Nothing here is enforced.

   Marked `retired: true` are courses Knox has presented in the past that no
   longer have a 2026 HSC exam. They stay searchable so old data still maps,
   but they are hidden from the picker unless you ask for them.
   ========================================================================= */
window.HSC_CATALOGUE = (function () {

  const CAT = {
    english:   { label: "English",        colour: "#3E7CA6" },
    maths:     { label: "Mathematics",    colour: "#3FA98A" },
    science:   { label: "Science",        colour: "#7A6BB5" },
    hsie:      { label: "HSIE",           colour: "#C0564C" },
    languages: { label: "Languages",      colour: "#C9A227" },
    arts:      { label: "Creative Arts",  colour: "#B5588F" },
    tech:      { label: "Technologies",   colour: "#5B8C5A" },
    pdhpe:     { label: "PDHPE",          colour: "#D0803A" },
    religion:  { label: "Religion",       colour: "#6E7B8B" }
  };

  /* Practice area appended to every subject that sits a written paper.
     Nearly everyone ends up making this themselves, so it may as well be there. */
  const PRACTICE = "Past papers — timed";

  const S = [

  /* ---------------------------------------------------------------- ENGLISH */
  { name: "English Advanced", cat: "english", units: 2,
    exams: [
      { paper: "Paper 1 — Texts and Human Experiences", date: "2026-10-13", start: "9.50 am", end: "11.30 am" },
      { paper: "Paper 2 — Modules",                     date: "2026-10-14", start: "9.25 am", end: "11.30 am" }
    ],
    areas: ["Common Module — Texts and Human Experiences",
            "Module A — Textual Conversations",
            "Module B — Critical Study of Literature",
            "Module C — The Craft of Writing",
            "Related material and quote bank"] },

  { name: "English Standard", cat: "english", units: 2,
    exams: [
      { paper: "Paper 1 — Texts and Human Experiences", date: "2026-10-13", start: "9.50 am", end: "11.30 am" },
      { paper: "Paper 2 — Modules",                     date: "2026-10-14", start: "9.25 am", end: "11.30 am" }
    ],
    areas: ["Common Module — Texts and Human Experiences",
            "Module A — Language, Identity and Culture",
            "Module B — Close Study of Literature",
            "Module C — The Craft of Writing",
            "Related material and quote bank"] },

  { name: "English EAL/D", cat: "english", units: 2,
    exams: [
      { paper: "Paper 1 — Module A and Focus on Writing", date: "2026-10-13", start: "9.50 am",  end: "11.30 am" },
      { paper: "Paper 2 — Module B and Module C",         date: "2026-10-14", start: "9.25 am",  end: "10.30 am" },
      { paper: "Listening Paper",                         date: "2026-10-14", start: "10.40 am", end: "11.10 am" }
    ],
    areas: ["Common Module — Texts and Human Experiences",
            "Module A — Language, Identity and Culture",
            "Module B — Close Study of Text",
            "Module C — Focus on Writing",
            "Listening skills"] },

  { name: "English Extension 1", cat: "english", units: 1,
    exams: [ { paper: "English Extension 1", date: "2026-10-28", start: "1.50 pm", end: "4.00 pm" } ],
    areas: ["Common Module — Literary Worlds",
            "Elective study",
            "Related texts",
            "Imaginative response practice",
            "Critical response practice"] },

  { name: "English Extension 2", cat: "english", units: 1,
    exams: [],
    note: "No written exam — assessed on the Major Work and Reflection Statement.",
    areas: ["Major Work — drafting",
            "Major Work — editing and redrafting",
            "Reflection Statement",
            "Independent research",
            "Journal"] },

  /* ------------------------------------------------------------ MATHEMATICS */
  { name: "Mathematics Standard 1", cat: "maths", units: 2,
    exams: [ { paper: "Mathematics Standard 1", date: "2026-10-19", start: "9.20 am", end: "11.30 am" } ],
    areas: ["Algebra — Types of Relationships",
            "Measurement — Right-angled Triangles",
            "Measurement — Rates",
            "Measurement — Scale Drawings",
            "Financial Maths — Investments",
            "Financial Maths — Depreciation and Loans",
            "Statistical Analysis — Further Statistical Analysis",
            "Networks — Networks and Paths",
            "Error log review"] },

  { name: "Mathematics Standard 2", cat: "maths", units: 2,
    exams: [ { paper: "Mathematics Standard 2", date: "2026-10-19", start: "9.20 am", end: "12 noon" } ],
    areas: ["Algebra — Types of Relationships",
            "Measurement — Non-right-angled Trigonometry",
            "Measurement — Rates and Ratios",
            "Financial Maths — Investments and Loans",
            "Financial Maths — Annuities",
            "Statistical Analysis — Bivariate Data Analysis",
            "Statistical Analysis — The Normal Distribution",
            "Networks — Network Concepts",
            "Networks — Critical Path Analysis",
            "Error log review"] },

  { name: "Mathematics Advanced", cat: "maths", units: 2,
    exams: [ { paper: "Mathematics Advanced", date: "2026-10-19", start: "9.20 am", end: "12.30 pm" } ],
    areas: ["Functions — Further Functions and Relations",
            "Trigonometric Functions and Graphs",
            "Calculus — Differential Calculus",
            "Calculus — Applications of Differentiation",
            "Calculus — Integral Calculus",
            "Financial Maths — Modelling Financial Situations",
            "Statistics — Descriptive and Bivariate Data",
            "Statistics — Random Variables",
            "Error log review"] },

  { name: "Mathematics Extension 1", cat: "maths", units: 1,
    exams: [ { paper: "Mathematics Extension 1", date: "2026-10-23", start: "1.50 pm", end: "4.00 pm" } ],
    areas: ["Proof by Mathematical Induction",
            "Vectors — Introduction to Vectors",
            "Trigonometric Equations",
            "Calculus — Further Calculus Skills",
            "Calculus — Applications of Calculus",
            "Statistics — The Binomial Distribution",
            "Error log review"] },

  { name: "Mathematics Extension 2", cat: "maths", units: 1,
    exams: [ { paper: "Mathematics Extension 2", date: "2026-10-19", start: "1.50 pm", end: "5.00 pm" } ],
    areas: ["The Nature of Proof",
            "Further Proof by Mathematical Induction",
            "Vectors — Further Work with Vectors",
            "Complex Numbers — Introduction",
            "Complex Numbers — Using Complex Numbers",
            "Calculus — Further Integration",
            "Mechanics — Applications of Calculus to Mechanics",
            "Error log review"] },

  /* ---------------------------------------------------------------- SCIENCE */
  { name: "Biology", cat: "science", units: 2,
    exams: [ { paper: "Biology", date: "2026-10-21", start: "9.25 am", end: "12.30 pm" } ],
    areas: ["Module 5 — Heredity",
            "Module 6 — Genetic Change",
            "Module 7 — Infectious Disease",
            "Module 8 — Non-infectious Disease and Disorders",
            "Working Scientifically and depth study"] },

  { name: "Chemistry", cat: "science", units: 2,
    exams: [ { paper: "Chemistry", date: "2026-10-30", start: "9.25 am", end: "12.30 pm" } ],
    areas: ["Module 5 — Equilibrium and Acid Reactions",
            "Module 6 — Acid/Base Reactions",
            "Module 7 — Organic Chemistry",
            "Module 8 — Applying Chemical Ideas",
            "Working Scientifically and depth study"] },

  { name: "Physics", cat: "science", units: 2,
    exams: [ { paper: "Physics", date: "2026-11-05", start: "9.25 am", end: "12.30 pm" } ],
    areas: ["Module 5 — Advanced Mechanics",
            "Module 6 — Electromagnetism",
            "Module 7 — The Nature of Light",
            "Module 8 — From the Universe to the Atom",
            "Working Scientifically and depth study"] },

  { name: "Investigating Science", cat: "science", units: 2,
    exams: [ { paper: "Investigating Science", date: "2026-11-03", start: "1.55 pm", end: "5.00 pm" } ],
    areas: ["Module 5 — Scientific Investigations",
            "Module 6 — Technologies",
            "Module 7 — Fact or Fallacy?",
            "Module 8 — Science and Society",
            "Depth study"] },

  { name: "Earth and Environmental Science", cat: "science", units: 2,
    exams: [ { paper: "Earth and Environmental Science", date: "2026-10-15", start: "9.25 am", end: "12.30 pm" } ],
    areas: ["Module 5 — Earth's Processes",
            "Module 6 — Hazards",
            "Module 7 — Climate Science",
            "Module 8 — Resource Management",
            "Working Scientifically and depth study"] },

  { name: "Science Extension", cat: "science", units: 1,
    exams: [ { paper: "Science Extension", date: "2026-10-26", start: "1.50 pm", end: "4.00 pm" } ],
    areas: ["Module 1 — The Foundations of Scientific Thinking",
            "Module 2 — The Scientific Research Proposal",
            "Module 3 — The Data, Evidence and Decisions",
            "Module 4 — The Scientific Research Report",
            "Literature review",
            "Data collection and analysis"] },

  /* ------------------------------------------------------------------- HSIE */
  { name: "Business Studies", cat: "hsie", units: 2,
    exams: [ { paper: "Business Studies", date: "2026-10-26", start: "9.25 am", end: "12.30 pm" } ],
    areas: ["Operations",
            "Marketing",
            "Finance",
            "Human Resources",
            "Business case studies",
            "Business report practice"] },

  { name: "Economics", cat: "hsie", units: 2,
    exams: [ { paper: "Economics", date: "2026-10-27", start: "1.55 pm", end: "5.00 pm" } ],
    areas: ["The Global Economy",
            "Australia's Place in the Global Economy",
            "Economic Issues",
            "Economic Policies and Management",
            "Statistics and current data"] },

  { name: "Legal Studies", cat: "hsie", units: 2,
    exams: [ { paper: "Legal Studies", date: "2026-11-02", start: "9.25 am", end: "12.30 pm" } ],
    areas: ["Core — Crime",
            "Core — Human Rights",
            "Option 1",
            "Option 2",
            "Legislation, cases and media file"] },

  { name: "Modern History", cat: "hsie", units: 2,
    exams: [ { paper: "Modern History", date: "2026-10-16", start: "9.25 am", end: "12.30 pm" } ],
    areas: ["Core — Power and Authority in the Modern World 1919–1946",
            "National Study",
            "Peace and Conflict",
            "Change in the Modern World",
            "Historiography and source analysis"] },

  { name: "Ancient History", cat: "hsie", units: 2,
    exams: [ { paper: "Ancient History", date: "2026-10-23", start: "9.25 am", end: "12.30 pm" } ],
    areas: ["Core — Cities of Vesuvius: Pompeii and Herculaneum",
            "Ancient Societies",
            "Personalities in Their Times",
            "Historical Periods",
            "Source analysis"] },

  { name: "History Extension", cat: "hsie", units: 1,
    exams: [ { paper: "History Extension", date: "2026-10-21", start: "1.50 pm", end: "4.00 pm" } ],
    areas: ["Part I — What is History?",
            "Historians and historiography",
            "Case study",
            "Part II — History Project"] },

  { name: "Geography", cat: "hsie", units: 2,
    exams: [ { paper: "Geography", date: "2026-11-02", start: "1.50 pm", end: "5.00 pm" } ],
    areas: ["Ecosystems at Risk",
            "Urban Places",
            "People and Economic Activity",
            "Senior Geography Project",
            "Fieldwork and skills"] },

  /* --------------------------------------------------------------- RELIGION */
  { name: "Studies of Religion I", cat: "religion", units: 1,
    exams: [ { paper: "Studies of Religion I", date: "2026-10-22", start: "9.25 am", end: "11.00 am" } ],
    areas: ["Religion and Belief Systems in Australia post-1945",
            "Religious Tradition Depth Study"] },

  { name: "Studies of Religion II", cat: "religion", units: 2,
    exams: [ { paper: "Studies of Religion II", date: "2026-10-22", start: "9.25 am", end: "12.30 pm" } ],
    areas: ["Religion and Belief Systems in Australia post-1945",
            "Religious Tradition Depth Study 1",
            "Religious Tradition Depth Study 2",
            "Religion and Peace",
            "Religion and Non-Religion"] },

  /* ------------------------------------------------------------------ PDHPE */
  { name: "Health and Movement Science", cat: "pdhpe", units: 2,
    exams: [ { paper: "Health and Movement Science", date: "2026-10-28", start: "9.20 am", end: "12.30 pm" } ],
    note: "Replaces PDHPE. First HSC examination is 2026.",
    areas: ["Focus Area 1 — Health in an Australian and Global Context",
            "Focus Area 2 — Training for Improved Performance",
            "Depth study",
            "Collaborative investigation"] },

  { name: "PDHPE", cat: "pdhpe", units: 2, retired: true, replacedBy: "Health and Movement Science",
    exams: [],
    note: "No 2026 HSC exam — replaced by Health and Movement Science.",
    areas: ["Core 1 — Health Priorities in Australia",
            "Core 2 — Factors Affecting Performance",
            "Option — Improving Performance",
            "Option — Sports Medicine"] },

  /* ----------------------------------------------------------- TECHNOLOGIES */
  { name: "Enterprise Computing", cat: "tech", units: 2,
    exams: [ { paper: "Enterprise Computing", date: "2026-10-29", start: "9.50 am", end: "12.20 pm" } ],
    areas: ["Data Science",
            "Data Visualisation",
            "Intelligent Systems",
            "Enterprise Project",
            "Interactive media and the user experience",
            "Networking systems and social computing",
            "Principles of cybersecurity"] },

  { name: "Software Engineering", cat: "tech", units: 2,
    exams: [ { paper: "Software Engineering", date: "2026-10-27", start: "9.50 am", end: "12.20 pm" } ],
    areas: ["Secure Software Architecture",
            "Programming for the Web",
            "Software Automation",
            "Software Engineering Project"] },

  { name: "Design and Technology", cat: "tech", units: 2,
    exams: [ { paper: "Design and Technology", date: "2026-10-29", start: "1.55 pm", end: "3.30 pm" } ],
    areas: ["Major Design Project",
            "Designing and Producing",
            "Innovation and Emerging Technologies",
            "Case study — designer/design innovation",
            "Portfolio"] },

  { name: "Industrial Technology", cat: "tech", units: 2,
    exams: [ { paper: "Industrial Technology", date: "2026-11-04", start: "1.55 pm", end: "3.30 pm" } ],
    areas: ["Major Project",
            "Industry Study",
            "Design and Management",
            "Workplace Communication",
            "Industry-specific content",
            "Workplace health and safety"] },

  { name: "Engineering Studies", cat: "tech", units: 2,
    exams: [ { paper: "Engineering Studies", date: "2026-10-20", start: "9.25 am", end: "12.30 pm" } ],
    areas: ["Civil Structures",
            "Personal and Public Transport",
            "Aeronautical Engineering",
            "Telecommunications Engineering",
            "Engineering reports",
            "Engineering mechanics and materials"] },

  { name: "Agriculture", cat: "tech", units: 2,
    exams: [ { paper: "Agriculture", date: "2026-10-15", start: "1.55 pm", end: "5.00 pm" } ],
    areas: ["Plant Production",
            "Animal Production",
            "Farm/Product Study",
            "Elective 1",
            "Elective 2"] },

  { name: "Information Processes and Technology", cat: "tech", units: 2,
    retired: true, replacedBy: "Enterprise Computing",
    exams: [],
    note: "No 2026 HSC exam — replaced by Enterprise Computing and Software Engineering.",
    areas: ["Project Management",
            "Information Systems and Databases",
            "Communication Systems",
            "Option — Transaction Processing Systems",
            "Option — Multimedia Systems"] },

  /* ---------------------------------------------------------- CREATIVE ARTS */
  { name: "Visual Arts", cat: "arts", units: 2,
    exams: [ { paper: "Art Criticism and Art History", date: "2026-10-30", start: "1.55 pm", end: "3.30 pm" } ],
    areas: ["Body of Work",
            "Section I — Art Criticism and Art History (short answer)",
            "Section II — Extended response",
            "Practice, Conceptual Framework and the Frames",
            "Artist case studies",
            "Visual Arts Process Diary"] },

  { name: "Drama", cat: "arts", units: 2,
    exams: [ { paper: "Drama", date: "2026-10-22", start: "1.55 pm", end: "3.30 pm" } ],
    areas: ["Australian Drama and Theatre",
            "Studies in Drama and Theatre",
            "Group Performance",
            "Individual Project",
            "Logbook"] },

  { name: "Music 1", cat: "arts", units: 2,
    exams: [ { paper: "Aural Skills", date: "2026-10-14", start: "1.55 pm", end: "3.00 pm" } ],
    areas: ["Aural Skills — concepts of music",
            "Core Performance",
            "Elective 1",
            "Elective 2",
            "Elective 3",
            "Repertoire practice"] },

  { name: "Music 2", cat: "arts", units: 2,
    exams: [ { paper: "Musicology and Aural Skills", date: "2026-10-14", start: "3.25 pm", end: "5.00 pm" } ],
    areas: ["Aural Skills",
            "Musicology — Mandatory Topic",
            "Musicology — Additional Topic",
            "Core Composition",
            "Sight Singing",
            "Performance"] },

  { name: "Music Extension", cat: "arts", units: 1,
    exams: [],
    note: "No written exam — assessed by performance, composition or musicology submission.",
    areas: ["Elected pathway — Performance",
            "Elected pathway — Composition",
            "Elected pathway — Musicology",
            "Repertoire and submission prep"] },

  /* -------------------------------------------------------------- LANGUAGES */
  { name: "Japanese Beginners", cat: "languages", units: 2,
    exams: [ { paper: "Japanese Beginners", date: "2026-10-13", start: "2.00 pm", end: "4.40 pm" } ],
    areas: ["Speaking — oral examination",
            "Listening",
            "Reading",
            "Writing in Japanese",
            "Vocabulary and kanji",
            "Grammar",
            "Prescribed themes and topics"] },

  { name: "Japanese Continuers", cat: "languages", units: 2,
    exams: [ { paper: "Japanese Continuers", date: "2026-10-13", start: "2.00 pm", end: "5.00 pm" } ],
    areas: ["Speaking — oral examination",
            "Listening and responding",
            "Reading and responding",
            "Writing in Japanese",
            "Vocabulary and kanji",
            "Grammar",
            "Prescribed themes and topics"] },

  { name: "Japanese Extension", cat: "languages", units: 1,
    exams: [ { paper: "Japanese Extension", date: "2026-10-16", start: "9.30 am", end: "11.30 am" } ],
    areas: ["Prescribed issue",
            "Prescribed text",
            "Listening and responding",
            "Writing in Japanese",
            "Monologue"] },

  { name: "Chinese Continuers", cat: "languages", units: 2,
    exams: [ { paper: "Chinese Continuers", date: "2026-10-20", start: "2.00 pm", end: "5.00 pm" } ],
    areas: ["Speaking — oral examination",
            "Listening and responding",
            "Reading and responding",
            "Writing in Chinese",
            "Vocabulary and characters",
            "Grammar",
            "Prescribed themes and topics"] },

  { name: "Chinese in Context", cat: "languages", units: 2,
    exams: [ { paper: "Chinese in Context", date: "2026-10-15", start: "2.00 pm", end: "4.40 pm" } ],
    areas: ["Speaking — oral examination",
            "Listening and responding",
            "Reading and responding",
            "Writing in Chinese",
            "Prescribed issues"] },

  { name: "Chinese Extension", cat: "languages", units: 1,
    exams: [ { paper: "Chinese Extension", date: "2026-10-22", start: "2.00 pm", end: "4.00 pm" } ],
    areas: ["Prescribed issue",
            "Prescribed text",
            "Listening and responding",
            "Writing in Chinese",
            "Monologue"] },

  { name: "French Continuers", cat: "languages", units: 2,
    exams: [ { paper: "French Continuers", date: "2026-11-03", start: "2.00 pm", end: "5.00 pm" } ],
    areas: ["Speaking — oral examination",
            "Listening and responding",
            "Reading and responding",
            "Writing in French",
            "Vocabulary",
            "Grammar",
            "Prescribed themes and topics"] },

  { name: "German Continuers", cat: "languages", units: 2,
    exams: [ { paper: "German Continuers", date: "2026-10-13", start: "2.00 pm", end: "5.00 pm" } ],
    areas: ["Speaking — oral examination",
            "Listening and responding",
            "Reading and responding",
            "Writing in German",
            "Vocabulary",
            "Grammar",
            "Prescribed themes and topics"] },

  { name: "German Extension", cat: "languages", units: 1,
    exams: [ { paper: "German Extension", date: "2026-10-16", start: "2.00 pm", end: "4.00 pm" } ],
    areas: ["Prescribed issue",
            "Prescribed text",
            "Listening and responding",
            "Writing in German",
            "Monologue"] }

  ];

  /* derived fields */
  S.forEach(s => {
    s.colour = s.colour || CAT[s.cat].colour;
    s.catLabel = CAT[s.cat].label;
    s.exam_date = s.exams.length ? s.exams.map(e => e.date).sort()[0] : null;
    if (s.exams.length && s.areas.indexOf(PRACTICE) === -1) s.areas = s.areas.concat([PRACTICE]);
  });

  const all = S.slice().sort((a, b) => a.name.localeCompare(b.name));

  return {
    version: "2026.1",
    source: "NESA 2026 HSC written examination timetable (01-05-26) and NESA Stage 6 syllabuses",
    categories: CAT,
    subjects: all,
    active: all.filter(s => !s.retired),
    byName: function (name) {
      const n = String(name || "").trim().toLowerCase();
      return all.find(s => s.name.toLowerCase() === n) || null;
    },
    /* every paper the crew could sit, in date order — drives the timetable view */
    papers: all.reduce((acc, s) => acc.concat(s.exams.map(e =>
      Object.assign({ subject: s.name, colour: s.colour }, e))), [])
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
  };
})();
