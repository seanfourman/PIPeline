// What a posting says in its own words, read with no AI, for its page: the skills it names (each the usual way, whether
// it requires one or counts it an advantage, and whether the profile shows it), and how it is worked: its kind, where
// and how many days in the office. The page's own data (posting-read.ts) comes first; these fill in what it lacks.
import { PLUS } from "./experience";

// A skill and how a posting names it. A short or common word is matched only where it can mean the skill.
const SKILLS: [string, RegExp][] = [
  ["Python", /\bpython\b/i],
  ["Java", /\bjava\b(?!\s*script)/i],
  ["JavaScript", /\bjavascript\b/i],
  ["TypeScript", /\btypescript\b/i],
  ["C++", /\bc\+\+|\bcpp\b/i],
  ["C#", /\bc#|\bc sharp\b/i],
  ["C", /(?<![\w.+#/-])C(?![\w+#-])(?!\s+level)/],
  ["Go", /\bgolang\b|\bGo\b(?=\s*[,)/]|\s+(?:and|or|lang)\b)/],
  ["Rust", /\brust\b/i],
  ["Kotlin", /\bkotlin\b/i],
  ["Swift", /\bswift\b/i],
  ["Scala", /\bscala\b/i],
  ["Ruby", /\bruby\b/i],
  ["PHP", /\bphp\b/i],
  ["SQL", /\bsql\b(?!\s*server)/i],
  ["PostgreSQL", /\bpostgres(?:ql)?\b/i],
  ["MySQL", /\bmysql\b/i],
  ["SQL Server", /\bsql\s*server\b|\bmssql\b/i],
  ["MongoDB", /\bmongo(?:db)?\b/i],
  ["Redis", /\bredis\b/i],
  ["Elasticsearch", /\belastic\s?search\b/i],
  ["React", /\breact(?:\.?js)?\b(?!\s*native)/i],
  ["React Native", /\breact\s+native\b/i],
  ["Angular", /\bangular(?:js)?\b/i],
  ["Vue", /\bvue(?:\.?js)?\b/i],
  ["Next.js", /\bnext\.?js\b/i],
  ["Node.js", /\bnode(?:\.?js)?\b/i],
  ["Express", /\bexpress\.?js\b|node(?:\.js)?\s*[/,&]\s*express\b/i],
  ["Django", /\bdjango\b/i],
  ["Flask", /\bflask\b/i],
  ["FastAPI", /\bfastapi\b/i],
  ["Spring", /\bspring\s*boot\b|\bspring\s+framework\b/i],
  [".NET", /(?<![\w])\.net\b|\basp\.net\b|\bdotnet\b/i],
  ["HTML/CSS", /\bhtml5?\b|\bcss3?\b/i],
  ["REST APIs", /\brest(?:ful)?\s*apis?\b|\brestful\b/i],
  ["GraphQL", /\bgraphql\b/i],
  ["gRPC", /\bgrpc\b/i],
  ["Microservices", /\bmicro-?services?\b/i],
  ["AWS", /\baws\b|amazon web services/i],
  ["Azure", /\bazure\b/i],
  ["GCP", /\bgcp\b|google cloud/i],
  ["Docker", /\bdocker\b/i],
  ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["Terraform", /\bterraform\b/i],
  ["Ansible", /\bansible\b/i],
  ["Jenkins", /\bjenkins\b/i],
  ["GitHub Actions", /\bgithub\s+actions\b/i],
  ["CI/CD", /\bci\s*\/\s*cd\b/i],
  ["Linux", /\blinux\b/i],
  ["Bash", /\bbash\b|\bshell\s+script/i],
  ["Git", /\bgit\b(?!hub|lab)/i],
  ["Kafka", /\bkafka\b/i],
  ["RabbitMQ", /\brabbitmq\b/i],
  ["Spark", /\b(?:apache\s+)?spark\b/i],
  ["Airflow", /\bairflow\b/i],
  ["Snowflake", /\bsnowflake\b/i],
  ["BigQuery", /\bbigquery\b/i],
  ["Databricks", /\bdatabricks\b/i],
  ["ETL", /\betl\b/i],
  ["Machine learning", /\bmachine\s+learning\b/i],
  ["Deep learning", /\bdeep\s+learning\b/i],
  ["Computer vision", /\bcomputer\s+vision\b/i],
  ["NLP", /\bnlp\b|natural\s+language\s+processing/i],
  ["LLMs", /\bllms?\b|large\s+language\s+models?/i],
  ["Reinforcement learning", /\breinforcement\s+learning\b/i],
  ["PyTorch", /\bpytorch\b/i],
  ["TensorFlow", /\btensorflow\b/i],
  ["scikit-learn", /\bscikit-?learn\b|\bsklearn\b/i],
  ["Pandas", /\bpandas\b/i],
  ["NumPy", /\bnumpy\b/i],
  ["OpenCV", /\bopencv\b/i],
  ["CUDA", /\bcuda\b/i],
  ["ROS", /\bros\s*2?\b/i],
  ["SLAM", /\bslam\b/i],
  ["Embedded", /\bembedded\b/i],
  ["RTOS", /\brtos\b/i],
  ["FPGA", /\bfpga\b/i],
  ["Verilog", /\bverilog\b/i],
  ["VHDL", /\bvhdl\b/i],
  ["Selenium", /\bselenium\b/i],
  ["Cypress", /\bcypress\b/i],
  ["Playwright", /\bplaywright\b/i],
  ["Appium", /\bappium\b/i],
  ["JMeter", /\bjmeter\b/i],
  ["Postman", /\bpostman\b/i],
  ["Pytest", /\bpytest\b/i],
  ["Jest", /\bjest\b/i],
  ["Test automation", /\b(?:qa|test)\s+automation\b|בדיקות\s+אוטומטיות|אוטומציה/i],
  ["Jira", /\bjira\b/i],
  ["Agile", /\bagile\b|\bscrum\b/i],
  ["Tableau", /\btableau\b/i],
  ["Power BI", /\bpower\s?bi\b/i],
  ["Excel", /\bexcel\b/i],
  ["Networking", /\btcp\/ip\b|\bnetworking\b|רשתות\s+תקשורת/i],
  ["Cyber security", /\bcyber\s*security\b|\binformation\s+security\b|אבטחת\s+מידע|סייבר/i],
  ["SAP", /\bsap\b/i],
  ["ABAP", /\babap\b/i],
  ["Salesforce", /\bsalesforce\b/i],
  ["Figma", /\bfigma\b/i],
  ["Unity", /\bunity\b(?=\s*(?:3d|engine|developer|[,/)]))/i],
  ["Unreal Engine", /\bunreal\b/i],
  ["MATLAB", /\bmatlab\b/i],
  ["LabVIEW", /\blabview\b/i],
];
const SHOWN = 12;
// A heading over the lines it counts an advantage ("Nice to have", "יתרון").
const PLUS_HEAD = /nice|advantage|bonus|preferred|plus|desirable|יתרון|יתרונות|רצוי/i;

export type Skill = { name: string; must: boolean; have: boolean };

// The skills a posting names, in the order it names them, up to twelve: required unless every line naming one counts
// it an advantage (or stands under a heading that does), and had when the profile names it too.
export function skillsIn(lines: string[], profile: string): Skill[] {
  const seen = new Map<string, Skill>();
  let plusHead = false;
  for (const line of lines) {
    if (line.startsWith("## ")) { plusHead = PLUS_HEAD.test(line); continue; }
    const plus = plusHead || PLUS.test(line);
    for (const [name, re] of SKILLS) {
      if (!re.test(line)) continue;
      const had = seen.get(name);
      if (had) { had.must ||= !plus; continue; }
      seen.set(name, { name, must: !plus, have: re.test(profile) });
    }
  }
  return [...seen.values()].slice(0, SHOWN);
}

// How a posting is worked, from its words: its kind, where, and how many days a week in the office.
export type WordFacts = { employment?: string; workMode?: string; officeDays?: number };
export function factsIn(text: string): WordFacts {
  const out: WordFacts = {};
  if (/\binternship\b|\bintern\b|התמחות/i.test(text)) out.employment = "internship";
  else if (/\bstudent\s+(?:position|job|role)\b|משרת\s+סטודנט|לסטודנטים|סטודנט\/ית/i.test(text)) out.employment = "student";
  else if (/\bpart[- ]time\b|משרה\s+חלקית|חצי\s+משרה/i.test(text)) out.employment = "part_time";
  else if (/\bfreelance\b|\bcontractor\b|פרילנס/i.test(text)) out.employment = "contract";
  else if (/\bfull[- ]time\b|משרה\s+מלאה/i.test(text)) out.employment = "full_time";
  if (/\bhybrid\b|היברידי|היברידית|משולב(?:ת)?\s+מהבית/i.test(text)) out.workMode = "hybrid";
  else if (/\bfully\s+remote\b|\bremote\b(?!\s+(?:sensing|control))|\bwork\s+from\s+home\b|עבודה\s+מהבית|מרחוק/i.test(text)) out.workMode = "remote";
  else if (/\bon[- ]?site\b|\bfrom\s+(?:the|our)\s+office\b|עבודה\s+מהמשרד/i.test(text)) out.workMode = "onsite";
  const days = /\b([1-5])\s*days?\s*(?:a|per)\s*week\s*(?:in|at|from)\s*(?:the|our)?\s*office\b/i.exec(text)
    ?? /([1-5])\s*ימים\s*(?:בשבוע\s*)?(?:מ|ב)המשרד/.exec(text);
  if (days) { out.officeDays = Number(days[1]); out.workMode ??= "hybrid"; }
  return out;
}
