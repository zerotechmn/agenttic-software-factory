# Five-minute FORGE pitch

Seven advantages, one architecture image, actual frontend visibility. Timings include pauses and the final 60-second walkthrough. The embedded walkthrough is about 51 seconds; a longer companion recording is included.

## Slide 1 — 0:00–0:20

AI код бичиж чаддаг болсон. Харин шаардлага тодруулах, ажлыг хуваарилах, өөрчлөлтийг шалгах, үр дүнг баталгаажуулах ажлыг хэн зохион байгуулах вэ? Бидний бүтээж буй Agentic Software Factory эдгээр ажлыг тусгай үүрэгтэй AI агентуудын уялдаатай workflow болгон зохион байгуулдаг. FORGE Realm тэр багийн ажлыг харагддаг болгоно. Нэг санаа. Олон агент. Нэг software factory.

## Slide 2 — 0:20–0:47

Эхний давуу тал бол үүргийн тодорхой хуваарилалт. Жишээлбэл, даалгавар удирдах апп бүтээх хүсэлт өглөө гэж бодъё. Product агент шаардлага, хүлээн авах шалгуурыг тодорхойлно. Architect өгөгдлийн бүтэц, contract болон ажлын төлөвлөгөөг гаргана. Developer код, unit test бичнэ. QA хэрэглэгчийн үйлдэл зөв ажиллаж байгааг шалгана. Энэ бол үүргийг тайлбарласан жишээ. Бичлэг дээрх бүтээгдэхүүн нь өөр төсөл юм.

## Slide 3 — 0:47–1:14

Хоёр дахь давуу тал бол workflow-ийн тодорхой удирдлага. Агентууд ажлыг гүйцэтгэнэ. Харин ямар ажил хэзээ эхлэхийг кодоор хэрэгжүүлсэн deterministic orchestrator шийднэ. Тэр нь task dependency, өөрчлөх файлын хүрээ, зэрэг ажиллах агентын тоо болон төсвийг хянадаг. Жишээлбэл, хоёр task нэг файлыг өөрчлөхөөр байвал систем тэдгээрийг дараалуулна. Ингэснээр гүйцэтгэл агентын таамагт бус, тодорхой дүрэмд тулгуурладаг.

## Slide 4 — 1:14–1:41

Гурав дахь давуу тал бол хоорондоо нийцтэй ажлуудыг зэрэг гүйцэтгэх боломж. Living Foundry-ийн recording дээр T1 нь proxy болон replay server, T2 нь reducer болон handoff, T3 нь frontend-ийн HUD, controls хэсгийг хариуцсан. Developer бүр тусдаа Git worktree-д ажиллана. Харин өөрчлөлтүүдийг main branch-д нэгтгэх ажиллагаа дараалалтай явагдаж, main дээр дахин шалгалт хийнэ. Энэ нь parallel development-ийг дэмждэг бүтэц. Хэдэн хувиар хурдан болсон гэсэн benchmark одоогоор зарлаагүй.

## Slide 5 — 1:41–2:08

Дөрөв дэх давуу тал бол агент яг юу хийж байгааг харах боломж. FORGE Realm дээр агент бүр дүртэй, ажиллах хэсэгтэй. Агент дээр дарахад ямар task хариуцаж байгаа, ямар tool ашигласан, ямар үйлдэл хийснийг activity panel-аас харж болно. Жишээлбэл, developer файл өөрчилсөн үү, test ажиллуулсан уу, эсвэл review хүлээж байна уу гэдгийг шалгана. Энд харуулж байгаа нь бодит frontend дээр тоглуулсан recorded workflow юм.

## Slide 6 — 2:08–2:35

Тав дахь давуу тал бол үр дүнг шалгаж болох бүртгэл. Агент дууслаа гэж хэлэх нь дангаараа хангалтгүй. T1 task-ийн sample recording дээр gate passed, review approved, merged гэсэн дараалал бүртгэгдсэн. Бид үүнийг event log болон sample state-аас харж болно. Гэхдээ task merge болсон гэдэг нь бүтээгдэхүүний бүх шаардлага QA-д тэнцсэн гэсэн үг биш. Нотлогдсон үр дүн болон дутуу нотолгоог ялгаж харуулна. Нэгдсэн phase report-ийн формат нь цаашдын сайжруулалт юм.

## Slide 7 — 2:35–3:02

Зургаа дахь давуу тал бол алдаа гарсан үед засах тодорхой зам. Бодит sample recording дахь T5 task эхний хоёр оролдлогоороо review-д буцаагдсан. Task-ийн шалгалт тэнцсэн ч reviewer кодын асуудал олсон гэсэн үг. Developer feedback авч дахин ажиллаад, гурав дахь оролдлогоор approval авч merge болсон. Систем retry-ийн хязгаар, escalation, task-ийг park хийх болон resume хийх механизмуудтай. T5 дээр escalation болсон гэж хэлэхгүй; гурван оролдлогын дараа merge болсон нь бүртгэлтэй.

## Slide 8 — 3:02–3:29

Долоо дахь давуу тал бол хүн чиглүүлэх боломжтой хэвээр байгаа явдал. Хэрэглэгч run-ийг зогсоох, үргэлжлүүлэх, шинэ ажил нэмэх, агент руу note өгөх боломжтой. Жишээлбэл, task үүсгэх үйлдлийг keyboard-оор ашиглаж болдог болго гэсэн чиглэл өгч болно. Энэ өгүүлбэр бол тайлбарласан жишээ; бид бичлэг хийхдээ ийм note илгээгээгүй. Live горимд note агентын дараагийн turn-д хүрнэ. Харин үе шат бүрд заавал хүний зөвшөөрөл авдаг систем гэж тайлбарлахгүй.

## Slide 9 — 3:29–4:00

Энэ зураг FORGE-ийн бүтцийг layer-уудаар харуулж байна. Оролтын хүсэлт, shared context болон task graph нь төв orchestrator-т очно. Orchestrator агентуудын ажил, scheduling, retry болон төсвийг удирдана. Execution хэсэгт Agent SDK, Git worktree, quality болон delivery үе шатууд байна. Event, state нь FORGE Realm-д харагдана. Баруун дээд талын Jev бол experimental routing хэсэг. Jev зөвшөөрөгдсөн task summary болон боломжит role-уудыг авч, хариуцах role-ийн санал гаргаад log-д бүртгэнэ. Execution-ийг өөрчлөхгүй. Одоогоор зөвхөн dev role сонголтод байгаа тул олон role хооронд сонгох чанарыг цаашид үнэлэх шаардлагатай.

## Slide 10 — 4:00–5:00

[Бичлэгийг эхлүүлнэ.] Энд FORGE-ийн бодит task board болон agent document дэлгэцүүдийг харуулж байна. Энэ нь шинэ live AI execution биш, хадгалагдсан Wheels2Go run-ийн мэдээлэл юм. Эхлээд агентын activity, Kanban board, task-ийн түүхийг харна. Handoffs-аас ажлаа хэрхэн дамжуулсныг, Timeline-аас үе шатны дарааллыг шалгана. Docs хэсэгт Product-ийн PRD, архитектур, design specification, task plan, contract байна. Дараа нь QA тайлан, security scan, deployment record-ийг харуулна. Эцэст нь run report, metrics, lessons learned болон шийдвэрүүдийг бүртгэсэн ledger-ийг үзнэ. Lessons learned нь өмнөх алдаанаас бүртгэсэн зөвлөмж болохоос model retraining биш. Энэ run-д research document байхгүй тул зохиомлоор нэмээгүй. Бид зөвхөн агентын хөдөлгөөнийг бус, хийсэн ажлынх нь нотолгоог дагаж харж байна. AI-аас зөвхөн код бүү хүс. AI-д баг өг — тэр багийн ажлыг харагддаг болго.

## Standalone 20-second opening

AI can write code. But who coordinates the work, reviews changes, and checks the result? We’re building Agentic Software Factory: specialized agents, a controlled workflow, and a visible team you can inspect. One idea. Multiple agents. One software factory.

## Closing

Don’t just ask AI to code. Give AI a team — and make its work visible.

## Judge questions

**Is this live?** The embedded clip is the actual frontend running a recorded build excerpt. A live console connects to current run events; the local console must already be running. We do not claim a fresh model-backed run in this recording.

**What does Jev control?** Nothing in execution today. The experimental TypeSafe shadow adapter with configured model jev-1.14.0 observes approved summaries and emits suggestions. The current hook offers only dev; cross-role quality needs evaluation.

**Does parallelism make this faster?** Worktrees and dependency/file-lane scheduling enable compatible concurrent tasks. We have not established a controlled speedup benchmark. Integration remains serialized.

**What if agents fail?** Checks, policy-based review, feedback, bounded retries/escalation, parked tasks, budget controls and persisted state provide recovery paths. Reviews may be skipped or fail with rulings; security scan alone does not block release. These controls do not guarantee correctness or hardened isolation.

**What would prove value?** Matched briefs with held-out acceptance tests, repeated runs, and comparable model/budget baselines. Report quality, total time/cost, failures and human interventions. Uniform phase summaries and cross-role routing evaluation are proposed next work.
