/**
 * The complete budget glossary: every term in the DBM's official BESF 2026
 * Glossary of Terms, rewritten in plain language, plus the constitutional
 * budget-process vocabulary. Rendered by the /glossary page.
 *
 * Entries carry optional `see` links into this site, so a term is one click
 * from the real numbers that illustrate it.
 */
/* ---------------------------------------------------------------- glossary */

export type Cat =
  | 'documents'
  | 'appropriations'
  | 'classes'
  | 'release'
  | 'structure'
  | 'players'
  | 'revenue'
  | 'debt'
  | 'oversight';

export const CATS: Record<Cat, string> = {
  documents: 'Documents & process',
  appropriations: 'Appropriations & funds',
  classes: 'Expense classes',
  release: 'How money moves',
  structure: 'Codes & structure',
  players: 'Who’s who',
  revenue: 'Revenue & the economy',
  debt: 'Debt & borrowings',
  oversight: 'Accountability & performance',
};

export interface Term {
  term: string;
  aka?: string;
  cat: Cat;
  def: string;
  detail?: string;
  see?: { to: string; label: string };
}

export const TERMS: Term[] = [
  // ---- documents & process ----
  {
    term: 'National Expenditure Program',
    aka: 'NEP · the President’s Budget',
    cat: 'documents',
    def: 'The Executive’s detailed spending proposal, submitted to Congress within 30 days of the State of the Nation Address. It is the basis of the General Appropriations Bill — a proposal, not yet a law.',
    detail: 'Congress deliberates the NEP, may realign but not increase the total the President recommends, and enacts it as the GAA.',
    see: { to: '/2027/overview', label: 'Read the FY 2027 NEP' },
  },
  {
    term: 'General Appropriations Act',
    aka: 'GAA',
    cat: 'documents',
    def: 'The law appropriating funds for government agencies for one budget year — the NEP after Congress has deliberated, amended, and passed it, and the President has signed it.',
    see: { to: '/gaa', label: 'Browse the GAA, FY 2020–2026' },
  },
  {
    term: 'General Appropriations Bill',
    aka: 'GAB',
    cat: 'documents',
    def: 'The NEP in bill form as it moves through the House, then the Senate, then a bicameral conference committee that reconciles the two versions. It becomes the GAA when signed.',
  },
  {
    term: 'Budget Call',
    cat: 'documents',
    def: 'The DBM memorandum that starts each cycle: it sets the macroeconomic assumptions, budget priorities, ceilings, forms, and calendar every agency must follow in preparing its proposal.',
  },
  {
    term: 'Budget of Expenditures and Sources of Financing',
    aka: 'BESF',
    cat: 'documents',
    def: 'The companion document to the NEP, constitutionally required, showing where the money will come from — taxes, other revenues, and borrowings — alongside what will be spent.',
  },
  {
    term: 'Special provisions',
    cat: 'documents',
    def: 'Conditions written into the GAA next to specific appropriations: what a fund may be used for, release requirements, earmarks, reporting duties. They are law, they change what a number means — and they exist only as prose in the budget volumes, not in any spreadsheet.',
    detail: 'A line item and its special provision must be read together: an amount can look generous on paper and be tightly fenced in the text beside it.',
  },
  {
    term: 'General provisions',
    cat: 'documents',
    def: 'The rules at the back of the GAA that govern all agencies at once — on savings, realignment, procurement, disclosure, and use of funds. Dozens of pages of prose that apply to every peso in the law.',
  },
  {
    term: 'Transparency Seal',
    cat: 'documents',
    def: 'The legal requirement that every agency post its approved budget, targets, accomplishment reports, and procurement awards on its own website — one of the first places to check what an agency says it did with its money.',
  },
  {
    term: 'Citizen participation',
    cat: 'documents',
    def: 'In the DBM’s own definition: citizens, organized as civil society organizations, monitoring specific programs and becoming partners in the formulation, monitoring, and evaluation of the national budget. Budget hearings are public; audit reports are public; this is designed to be watched.',
  },
  {
    term: 'Bicameral Conference Committee',
    aka: 'bicam',
    cat: 'documents',
    def: 'The panel of House and Senate members that reconciles the two chambers’ versions of the budget bill. Its report is voted on without amendment, which is why late changes here draw scrutiny.',
  },
  {
    term: 'Reenacted budget',
    cat: 'documents',
    def: 'If Congress fails to pass the GAA before the fiscal year starts, last year’s GAA stays in force until the new one is enacted — the Constitution’s failsafe against a shutdown, at the cost of funding new programs late.',
  },
  {
    term: 'Line-item veto',
    cat: 'documents',
    def: 'The President may veto individual items in an appropriations bill while signing the rest into law — a power that exists for the budget but not for ordinary legislation.',
  },
  {
    term: 'Supplemental appropriations',
    cat: 'documents',
    def: 'An additional appropriations law passed mid-year when the enacted budget proves insufficient. It must be supported by new revenue sources if it creates new offices or programs.',
  },
  // ---- kinds of appropriations ----
  {
    term: 'Appropriation',
    cat: 'appropriations',
    def: 'An authorization by law to spend public funds — up to a set amount, for a stated purpose, under stated conditions. No money leaves the Treasury without one; that rule is in the Constitution.',
  },
  {
    term: 'New General Appropriations',
    cat: 'appropriations',
    def: 'The part of the budget Congress actually votes on each year: the agency budgets and special purpose funds written into the annual GAA.',
  },
  {
    term: 'Automatic appropriations',
    cat: 'appropriations',
    def: 'Spending authorized once by a standing law and released every year without passing through the annual budget debate. Congress does not vote on these amounts each year — they are set aside automatically.',
    detail:
      'The biggest pieces: interest on the national debt (automatic since the 1977 Budget Reform Decree, carried into the Administrative Code), the National Tax Allotment for local governments, retirement and life insurance premiums for government employees (RLIP), net lending to government corporations, and tax expenditure subsidies. In the FY 2027 NEP these total ₱2.58 trillion — about 36% of the whole budget — before deliberation touches a single line.',
    see: { to: '/2027/d/AUTO', label: 'See the FY 2027 automatic appropriations' },
  },
  {
    term: 'Special Purpose Funds',
    aka: 'SPFs',
    cat: 'appropriations',
    def: 'Lump sums in the GAA for purposes whose final recipients aren’t known at budget time — released to agencies during the year as the need is established.',
    detail: 'Examples: the National Disaster Risk Reduction and Management (Calamity) Fund, the Contingent Fund, the Pension and Gratuity Fund, and the Miscellaneous Personnel Benefits Fund.',
    see: { to: '/2027/d/SPF', label: 'See the FY 2027 special purpose funds' },
  },
  {
    term: 'Unprogrammed appropriations',
    cat: 'appropriations',
    def: 'Standby authority at the back of the GAA: it can only be spent if extra money actually shows up — revenue collections above target, new revenue sources, or approved project loans.',
    detail: 'Because it depends on windfalls, moving big-ticket items into unprogrammed appropriations effectively makes their funding conditional.',
  },
  {
    term: 'Continuing appropriations',
    cat: 'appropriations',
    def: 'Appropriations that remain available beyond the year they were enacted for, under the rules of the annual GAA — as opposed to annual appropriations, which lapse.',
  },
  {
    term: 'National Tax Allotment',
    aka: 'NTA · formerly IRA',
    cat: 'appropriations',
    def: 'Local governments’ automatic share of national taxes: 40% of collections from the third preceding year, divided among provinces, cities, municipalities, and barangays by population, land area, and equal sharing.',
    detail: 'Renamed from the Internal Revenue Allotment after the Supreme Court’s Mandanas-Garcia ruling widened the base from internal revenue taxes to all national taxes, including customs collections.',
  },
  {
    term: 'Retirement and Life Insurance Premiums',
    aka: 'RLIP',
    cat: 'appropriations',
    def: 'The national government’s share of premium payments to GSIS for government employees’ life insurance and retirement benefits — released automatically, agency by agency.',
  },
  {
    term: 'Net lending',
    cat: 'appropriations',
    def: 'Advances by the national government to service the guaranteed debt of government corporations, and loans relent to them — automatically appropriated.',
  },
  {
    term: 'Debt service',
    cat: 'appropriations',
    def: 'Payments on the national debt. Interest payments are automatically appropriated and appear in the expenditure program; principal amortization is settled as financing, outside the program — so the budget’s “debt service” figure usually means interest only.',
  },
  {
    term: 'Budgetary Support to Government Corporations',
    aka: 'BSGC',
    cat: 'appropriations',
    def: 'National government assistance to GOCCs — equity, subsidies, or net lending — so corporations like PhilHealth or the National Food Authority can carry out public mandates their own revenues don’t cover.',
    see: { to: '/2027/d/35', label: 'See BSGC in the FY 2027 NEP' },
  },
  {
    term: 'Allocations to Local Government Units',
    aka: 'ALGU',
    cat: 'appropriations',
    def: 'The umbrella for national government transfers to LGUs: the automatic NTA plus GAA-appropriated items like the Local Government Support Fund, special shares in national taxes, and the Metropolitan Manila Development Authority.',
  },
  // ---- expense classes ----
  {
    term: 'Personnel Services',
    aka: 'PS',
    cat: 'classes',
    def: 'Pay for people: salaries and wages, allowances like PERA, bonuses, honoraria, and other compensation for permanent, temporary, contractual, and casual government employees.',
  },
  {
    term: 'Maintenance and Other Operating Expenses',
    aka: 'MOOE',
    cat: 'classes',
    def: 'The cost of keeping government running day to day: supplies and materials, travel, utilities like water and power, repairs, and services contracted out — everything operational that isn’t pay or capital.',
  },
  {
    term: 'Capital Outlays',
    aka: 'CO',
    cat: 'classes',
    def: 'Spending on things that last beyond the year and add to government assets: roads, buildings, equipment, and investments in the capital stock of government corporations.',
  },
  {
    term: 'Financial Expenses',
    aka: 'FinEx',
    cat: 'classes',
    def: 'Interest, guarantee and management fees, bank charges, and similar costs of owning or borrowing — in the national budget, dominated by interest on the public debt.',
  },
  // ---- how money moves ----
  {
    term: 'Allotment',
    cat: 'release',
    def: 'The share of an appropriation an agency is actually authorized to commit. An appropriation is permission on paper; the allotment is the spending limit released against it.',
  },
  {
    term: 'Obligation',
    cat: 'release',
    def: 'A binding commitment — a signed contract, a purchase order, a payroll — that ties the government to pay. Agencies may only obligate within their released allotments.',
  },
  {
    term: 'Disbursement',
    cat: 'release',
    def: 'The actual payment: cash (or its non-cash equivalent) leaving the government to settle an obligation. This is the step where the budget finally becomes money spent.',
  },
  {
    term: 'GAA as the Allotment Order',
    aka: 'GAARD / GAAAO',
    cat: 'release',
    def: 'For most items, the GAA itself now serves as the release document — agency budgets are considered released the moment the law takes effect, instead of waiting for individual paperwork.',
  },
  {
    term: 'Special Allotment Release Order',
    aka: 'SARO',
    cat: 'release',
    def: 'The DBM document releasing allotment for items that still need one — spending whose release is conditioned on laws, clearances, or documentary requirements, including most special purpose funds.',
  },
  {
    term: 'Notice of Cash Allocation',
    aka: 'NCA',
    cat: 'release',
    def: 'The DBM’s authority for actual cash: it tells the servicing banks how much an agency may draw to pay the obligations it has incurred. No NCA, no checks.',
  },
  {
    term: 'Cash Budgeting System',
    cat: 'release',
    def: 'The rule, in force since 2019, that appropriations are available for obligation only within the fiscal year (with a limited payment period after) — pushing agencies to implement within the year they are funded.',
  },
  // ---- codes & structure ----
  {
    term: 'Unified Accounts Code Structure',
    aka: 'UACS',
    cat: 'structure',
    def: 'The government-wide coding system — built jointly by DBM, COA, DOF, and the Treasury — that gives every funding source, agency, program, and expense object a consistent code, so budget, spending, and audit reports can be matched.',
    see: { to: '/2027/methodology', label: 'How this site uses UACS codes' },
  },
  {
    term: 'Program / Activity / Project',
    aka: 'P/A/P',
    cat: 'structure',
    def: 'The budget’s working unit: any work process an agency undertakes to deliver outputs, represented as an item of appropriation. Programs group activities and projects toward one outcome.',
  },
  {
    term: 'Program Expenditure Classification',
    aka: 'PREXC',
    cat: 'structure',
    def: 'The way agency budgets are structured into a hierarchy — organizational outcomes, programs, sub-programs, activities, and projects — so spending can be read against what it is supposed to achieve.',
  },
  {
    term: 'GAS · STO · Operations',
    cat: 'structure',
    def: 'Every agency budget splits into three cost components: General Administration and Support (overhead), Support to Operations (staff and technical support), and Operations (the direct delivery of the agency’s mandate).',
  },
  {
    term: 'Operating Unit',
    cat: 'structure',
    def: 'The organizational unit that actually implements — a regional office, a schools division, a hospital. Budgets are released down to this level.',
  },
  {
    term: 'Object of expenditure',
    cat: 'structure',
    def: 'The finest-grained classification under an expense class: “Salaries and Wages – Regular”, “Electricity Expenses”, “Buildings”. On this site, a line item is one object code in one fund in one operating unit.',
    see: { to: '/2027/search', label: 'Search line items by object' },
  },
  {
    term: 'Special Account in the General Fund',
    aka: 'SAGF',
    cat: 'structure',
    def: 'An earmark inside the General Fund: proceeds of a specific revenue measure recorded separately and reserved by law for a specific purpose — like the Malampaya fund for energy.',
  },
  {
    term: 'Off-budget funds',
    aka: 'retained income · revolving funds',
    cat: 'structure',
    def: 'Money agencies are allowed by law to keep and spend outside the annual appropriations — retained hospital income, business-type receipts, trust funds. It is public money, but you will not find it in the GAA’s totals.',
  },
  // ---- documents & process (BESF full set) ----
  {
    term: 'Budget',
    cat: 'documents',
    def: 'The government’s financial plan for one fiscal year: where the money will come from (income and borrowings) and where it will go, in pursuit of national objectives. The state’s key instrument for its socio-economic goals.',
  },
  {
    term: 'Budget Priorities Framework',
    aka: 'BPF',
    cat: 'documents',
    def: 'The document that tells all agencies which objectives and programs to focus their proposals on, drawn from the Philippine Development Plan — the administration’s priorities, in writing, before a single peso is proposed.',
  },
  {
    term: 'Budget Execution Documents',
    aka: 'BEDs',
    cat: 'documents',
    def: 'The plans agencies must file before spending: a financial plan of quarterly obligations, a physical plan of quarterly targets, and a monthly disbursement program. What an agency said it would do, on the record, before the year began.',
  },
  {
    term: 'Philippine Development Plan',
    aka: 'PDP',
    cat: 'documents',
    def: 'The government’s six-year development blueprint, reflecting the administration’s socioeconomic policies and strategies. Budget priorities are supposed to trace back to it.',
  },
  {
    term: 'Medium-Term Fiscal Framework',
    aka: 'MTFF',
    cat: 'documents',
    def: 'A six-year fiscal plan setting the deficit, revenue, and spending targets the government intends to hit within the President’s term — the arithmetic every annual budget is supposed to fit inside.',
  },
  {
    term: 'Medium-Term Expenditure Framework',
    aka: 'MTEF',
    cat: 'documents',
    def: 'A planning approach that looks three years ahead instead of one, so this year’s decisions account for the future costs they commit the government to.',
  },
  {
    term: 'Forward Estimates',
    aka: 'FEs',
    cat: 'documents',
    def: 'Projections of what existing, already-approved programs will cost over the next three years — the amount needed just to keep doing what government already does.',
  },
  {
    term: 'Fiscal Space',
    cat: 'documents',
    def: 'The room for anything new: projected available funding minus the forward estimates of ongoing programs. Small fiscal space means most of the budget is spoken for before deliberations start.',
  },
  {
    term: 'Fiscal Policy',
    cat: 'documents',
    def: 'Government policy on raising resources through taxes and borrowing, and on the level and mix of spending — the half of economic policy the budget embodies.',
  },
  {
    term: 'Monetary Policy',
    cat: 'documents',
    def: 'The other half: regulating money and liquidity in the economy — inflation control, the exchange rate, growth. Run by the Bangko Sentral, not the budget, but every budget assumes it.',
  },
  {
    term: 'Two-Tier Budgeting Approach',
    aka: '2TBA',
    cat: 'documents',
    def: 'Deliberating the budget in two passes: first the cost of continuing existing programs, then — separately — new spending proposals and expansions. Keeps the “new” visible instead of buried in the base.',
  },
  {
    term: 'Zero-Based Budgeting',
    aka: 'ZBB',
    cat: 'documents',
    def: 'Evaluating major programs from scratch: is the objective still relevant, is it being achieved, is there a better way — and should funding continue, grow, shrink, or stop.',
  },
  {
    term: 'Performance-Informed Budgeting',
    aka: 'PIB',
    cat: 'documents',
    def: 'Linking fund allocation to measurable outputs and outcomes, so performance data informs — though does not mechanically determine — what a program gets next year.',
  },
  {
    term: 'Program Convergence Budgeting',
    aka: 'PCB',
    cat: 'documents',
    def: 'Budgeting that coordinates related programs across several departments toward one goal, instead of letting each agency fund its slice in isolation.',
  },
  {
    term: 'Public Expenditure Management',
    aka: 'PEM',
    cat: 'documents',
    def: 'The discipline behind the budget, with three stated objectives: spend within sustainable limits, spend on the right things, and get value for money.',
  },
  {
    term: 'Public Financial Management',
    aka: 'PFM',
    cat: 'documents',
    def: 'The whole machinery of raising and managing public money — from tax collection to service delivery — of which the annual budget is the central instrument.',
  },
  {
    term: 'Public Investment Program',
    aka: 'PIP',
    cat: 'documents',
    def: 'The rolling list of priority programs and projects the government intends to implement over the medium term, tied to the outcomes of the Philippine Development Plan.',
  },
  {
    term: 'Expenditure Program',
    cat: 'documents',
    def: 'The approved ceiling on obligations the government may incur in a budget year, backed by estimated resources — the budget’s topline as a limit, not a target.',
  },
  {
    term: 'Operating Program',
    cat: 'documents',
    def: 'The slice of the expenditure program used for delivering goods and services in the year — PS, MOOE, financial expenses, and capital outlays.',
  },
  {
    term: 'Legislative Agenda',
    cat: 'documents',
    def: 'The list of proposed laws the administration wants passed to support its policies and programs — often previewed in the budget documents.',
  },
  {
    term: 'Regional Development Plans',
    cat: 'documents',
    def: 'Six-year development plans for each region, coordinated by regional planning offices and approved by the Regional Development Councils.',
  },
  {
    term: 'Budget and Treasury Management System',
    aka: 'BTMS',
    cat: 'documents',
    def: 'The government’s integrated financial-management information system: one platform meant to track appropriations, releases, and cash across agencies in real time.',
  },
  {
    term: 'Online Submission of Budget Proposal System',
    aka: 'OSBP',
    cat: 'documents',
    def: 'The DBM web system through which agencies encode and submit their budget proposals, using the standard account code structure.',
  },
  {
    term: 'MITHI',
    aka: 'Medium-Term ICT Harmonization Initiative',
    cat: 'documents',
    def: 'The mechanism that plans and reviews all government ICT spending in one process, so agencies’ technology budgets are harmonized rather than duplicated.',
  },
  // ---- appropriations & funds (BESF full set) ----
  {
    term: 'Item of Appropriation',
    cat: 'appropriations',
    def: 'One amount, for one program/activity/project or purpose, in the appropriations law — the unit the President’s line-item veto operates on.',
  },
  {
    term: 'General Fund',
    cat: 'appropriations',
    def: 'The government’s main pot: all receipts not earmarked elsewhere, available for any purpose Congress chooses to apply it to.',
  },
  {
    term: 'Revolving Funds',
    cat: 'appropriations',
    def: 'Receipts from an agency’s business-type activities, kept in a government depository bank and used to keep that activity running — self-perpetuating, self-liquidating, and by rule never for discretionary or representation expenses.',
  },
  {
    term: 'Retained Income',
    cat: 'appropriations',
    def: 'Collections an agency is authorized by law to keep and spend for its own operations instead of remitting to the Treasury — a big reason an agency’s real resources can exceed its GAA budget.',
  },
  {
    term: 'Trust Fund',
    cat: 'appropriations',
    def: 'Money held by a government agency or officer as trustee, agent, or administrator for a specific obligation — held for a purpose, not owned by the holder.',
  },
  {
    term: 'Trust Liabilities',
    cat: 'appropriations',
    def: 'The accounting mirror of trust receipts: collections held in trust from another agency or party for a specific purpose, recorded as a liability until fulfilled.',
  },
  {
    term: 'Custodial Funds',
    cat: 'appropriations',
    def: 'Receipts an agency holds as custodian for someone else — deposits awaiting a court case’s outcome, or funds held as trustee — collected as an agent, not as income.',
  },
  {
    term: 'Fiduciary Fund',
    cat: 'appropriations',
    def: 'A fund of monies that came into a government officer’s possession as trustee or guarantee for an obligation; only the interest earnings are usable.',
  },
  {
    term: 'Sinking Fund',
    cat: 'appropriations',
    def: 'Money the Treasury sets aside regularly to repay bonds coming due in the future — invested in safe securities until the debt matures. Used only for domestic debt.',
  },
  {
    term: 'Working Fund',
    cat: 'appropriations',
    def: 'Seed money a foreign lender or donor deposits with the Treasury for a foreign-assisted project, drawn down for eligible expenses and replenished as the project spends.',
  },
  {
    term: 'Non-Budgetary Accounts',
    cat: 'appropriations',
    def: 'Trust liabilities, sinking funds, and other accounts that sit outside the national budget entirely — public money the NEP and GAA totals do not include.',
  },
  {
    term: 'Centrally-Managed Items',
    aka: 'CMIs',
    cat: 'appropriations',
    def: 'Budget lines whose final recipient office or allocation is not yet identified in the GAA; released only when the agency files a Special Budget Request. Another place where a big number hides an undecided distribution.',
  },
  {
    term: 'Tax Expenditure Subsidy',
    cat: 'appropriations',
    def: 'A subsidy that pays a government agency’s or corporation’s tax bill for it — booked as both spending and revenue, automatically appropriated, and easy to miss because no cash appears to move.',
  },
  {
    term: 'Subsidy',
    cat: 'appropriations',
    def: 'A direct or indirect payment, concession, or privilege granted by government to firms, households, or other government units to promote a public objective.',
  },
  {
    term: 'BARMM Annual Block Grant',
    cat: 'appropriations',
    def: 'The Bangsamoro region’s automatically appropriated share of national internal revenue and customs collections, set by the Bangsamoro Organic Law.',
  },
  {
    term: 'Local Government Support Fund',
    aka: 'LGSF',
    cat: 'appropriations',
    def: 'Financial assistance to local government units for priority programs and projects, as provided in the GAA — national money granted on top of the automatic National Tax Allotment.',
  },
  {
    term: 'Special Health Fund',
    aka: 'SHF',
    cat: 'appropriations',
    def: 'The pooled health financing at province- or city-wide level under Universal Health Care — where population-based and individual health service money converges locally.',
  },
  {
    term: 'Risk Management Fund',
    aka: 'RMF',
    cat: 'appropriations',
    def: 'A dedicated fund under the PPP Code for paying contingent liabilities that arise from public-private partnership contracts — the budget’s shock absorber for PPP guarantees coming due.',
  },
  // ---- how money moves (BESF full set) ----
  {
    term: 'Allotment Release Program',
    aka: 'ARP',
    cat: 'release',
    def: 'The overall ceiling on obligational authority that may be released to agencies for the year, from all fund sources — the release plan sitting on top of the appropriations.',
  },
  {
    term: 'General Allotment Release Order',
    aka: 'GARO',
    cat: 'release',
    def: 'One obligational authority issued to all agencies at once for a common automatically-appropriated item — used for the government’s share in employee retirement and insurance premiums.',
  },
  {
    term: 'Obligational Authority',
    cat: 'release',
    def: 'The DBM document that authorizes an agency to incur obligations or sign contracts — the umbrella term for the GAA-as-release, SAROs, and GAROs.',
  },
  {
    term: 'Disbursement Authority',
    cat: 'release',
    def: 'The document that authorizes actual payment of obligations: the NCA for cash, plus the non-cash and special variants (NCAA, CDC, TRA).',
  },
  {
    term: 'Cash Disbursement Ceiling',
    aka: 'CDC',
    cat: 'release',
    def: 'A disbursement authority for departments with overseas posts — foreign service posts may use the income they collect abroad, up to a ceiling, instead of waiting for cash from Manila.',
  },
  {
    term: 'Non-Cash Availment Authority',
    aka: 'NCAA',
    cat: 'release',
    def: 'A disbursement authority covering obligations settled without cash changing hands — typically when a foreign lender pays a supplier directly and the government records the availment.',
  },
  {
    term: 'Tax Remittance Advice',
    aka: 'TRA',
    cat: 'release',
    def: 'The paperless way agencies remit the taxes they withhold: a document filed with the BIR recording the remittance as both tax collection and disbursement, with no cash moving between government accounts.',
  },
  {
    term: 'Advice to Debit Account',
    aka: 'ADA',
    cat: 'release',
    def: 'The instruction that actually pays suppliers: it authorizes the servicing bank to debit the agency’s account and credit creditors on an approved list.',
  },
  {
    term: 'Modified Disbursement System',
    aka: 'MDS',
    cat: 'release',
    def: 'The system through which agencies settle payables — checks or direct bank credits drawn against the Treasurer of the Philippines’ account in authorized servicing banks.',
  },
  {
    term: 'Treasury Single Account',
    aka: 'TSA',
    cat: 'release',
    def: 'The banking arrangement putting all government monies in one account (or one linked set), giving the Treasury a consolidated daily view of the state’s cash position.',
  },
  {
    term: 'Common Fund System',
    cat: 'release',
    def: 'Flexibility within an agency’s cash: after covering mandatory requirements, agencies may use available cash balances under their regular sub-accounts to settle any due payables.',
  },
  {
    term: 'Commitment',
    cat: 'release',
    def: 'An obligation with a signed contract but no delivery yet — goods not delivered, services not rendered. Also called “not yet due and demandable”.',
  },
  {
    term: 'Accounts Payable',
    aka: 'due and demandable obligations',
    cat: 'release',
    def: 'Obligations where the goods or services have been delivered and accepted but not yet paid — the government’s unpaid bills, whether from this year or prior years.',
  },
  {
    term: 'Unpaid Obligations',
    cat: 'release',
    def: 'Everything incurred but not yet paid: both accounts payable (delivered, awaiting payment) and commitments (contracted, awaiting delivery).',
  },
  {
    term: 'Unobligated Allotments',
    cat: 'release',
    def: 'Released spending authority no contract has claimed yet. Persistently large unobligated balances are a classic sign an agency cannot spend its budget on schedule.',
  },
  {
    term: 'Obligation-based Budgeting',
    cat: 'release',
    def: 'The traditional approach where the budget authorizes commitments without a strict time limit on payment — the counterpart of cash budgeting, where authority expires with the year.',
  },
  {
    term: 'Multi-Year Contractual Authority',
    aka: 'MYCA',
    cat: 'release',
    def: 'DBM authorization to sign a multi-year contract covering its full cost — so a three-year project isn’t funded one nervous year at a time.',
  },
  {
    term: 'Forward Obligational Authority',
    aka: 'FOA',
    cat: 'release',
    def: 'DBM certification, used in negotiating foreign-assisted projects, that funds for the full project cost will be made available in the government’s long-term capital program.',
  },
  {
    term: 'Certificate of Budget Inclusion',
    aka: 'CBI',
    cat: 'release',
    def: 'The government-corporation equivalent of a multi-year authority: board approval covering the full contract cost of a multi-year procurement.',
  },
  {
    term: 'Letter of Commitment',
    aka: 'LOC',
    cat: 'release',
    def: 'The assurance that budgetary support for a solicited public-private partnership project — availability payments, right-of-way, viability gap funding — will be included in the national government’s long-term program.',
  },
  {
    term: 'Direct Payment',
    cat: 'release',
    def: 'A disbursement scheme for foreign-assisted projects where the lender pays suppliers and contractors directly out of loan proceeds — money that never passes through Philippine accounts.',
  },
  {
    term: 'Constructive Receipt of Cash',
    aka: 'CRC',
    cat: 'release',
    def: 'Recording foreign loan or grant proceeds that arrived as goods and services rather than cash — the lender paid the supplier, and the books record it as if cash had been received.',
  },
  {
    term: 'Negotiated Checks',
    cat: 'release',
    def: 'Government checks already presented for encashment at the servicing banks — spending that has actually left the building.',
  },
  {
    term: 'Outstanding Checks',
    aka: 'check floats',
    cat: 'release',
    def: 'Checks issued but not yet presented for payment — the gap between what agencies have “paid” and what has left the Treasury’s cash.',
  },
  {
    term: 'Action Document Releasing System',
    aka: 'ADRS',
    cat: 'release',
    def: 'The web application that releases approved DBM action documents to agencies digitally, replacing printed, physically-signed releases.',
  },
  {
    term: 'Government Purchase Card',
    aka: 'GPC',
    cat: 'release',
    def: 'An electronic card authorized cardholders can use as an alternative payment mode for eligible official purchases — a credit card, with rules.',
  },
  {
    term: 'Authority to Purchase Motor Vehicle',
    aka: 'APMV',
    cat: 'release',
    def: 'The approval document an agency needs before buying any motor vehicle — stating the intended user, quantity, cost, funding source, and specifications. Yes, government vehicles have their own approval regime.',
  },
  {
    term: 'Authority to Rent Motor Vehicle',
    aka: 'ARMV',
    cat: 'release',
    def: 'DBM approval required to rent a vehicle for more than fifteen continuous days — the rental counterpart of the APMV.',
  },
  // ---- codes & structure (BESF full set) ----
  {
    term: 'Program',
    cat: 'structure',
    def: 'A group of activities and projects contributing to one outcome, with unique expected results, a clear target population, a defined method of intervention, and accountable management.',
  },
  {
    term: 'Sub-program',
    cat: 'structure',
    def: 'A program within a program: a more specific intervention or a more defined set of target clients inside a bigger program.',
  },
  {
    term: 'Project',
    cat: 'structure',
    def: 'A special undertaking with a definite timeframe and a predetermined output — foreign-assisted if financed by foreign loans or grants, locally-funded if financed from revenues and domestic borrowing.',
  },
  {
    term: 'Activity',
    cat: 'structure',
    def: 'A work process that contributes to implementing a program or sub-program — the smallest verb in the budget’s structure.',
  },
  {
    term: 'Regular Program',
    cat: 'structure',
    def: 'The homogenous set of activities an agency exists to perform — its core mandate, basic administrative maintenance, and staff support.',
  },
  {
    term: 'Project Cost',
    cat: 'structure',
    def: 'The total amount necessary to implement and complete a project over its full duration — not just this year’s slice.',
  },
  {
    term: 'Classification of the Functions of Government',
    aka: 'COFOG',
    cat: 'structure',
    def: 'The international standard classifying spending by purpose — education, health, defense, and so on — which lets budgets be compared across countries and tracked over time regardless of agency reorganizations.',
  },
  {
    term: 'Allotment Class',
    cat: 'structure',
    def: 'The four-way classification of any appropriation item: Personnel Services, MOOE, Financial Expenses, and Capital Outlays — the same split this site shows as expense classes.',
  },
  {
    term: 'Itemized Positions',
    cat: 'structure',
    def: 'The approved posts in an agency’s regular personnel plantilla — the headcount behind the Personnel Services number.',
  },
  {
    term: 'Unified Reporting System',
    aka: 'URS',
    cat: 'structure',
    def: 'The online system through which agencies submit their plans, targets, and accountability reports using the unified account code structure.',
  },
  // ---- who's who ----
  {
    term: 'National Government Agencies',
    aka: 'NGAs',
    cat: 'players',
    def: 'The departments, bureaus, and offices of the Executive, Legislative, and Judicial branches, plus the Constitutional Commissions, the Commission on Human Rights, and the Ombudsman — as distinguished from government corporations and local governments.',
  },
  {
    term: 'Government-Owned or -Controlled Corporation',
    aka: 'GOCC',
    cat: 'players',
    def: 'A corporation vested with public functions and owned by the Republic, directly or through its instrumentalities — from power utilities to irrigation. Includes government financial institutions and corporate entities.',
  },
  {
    term: 'Government Financial Institutions',
    aka: 'GFIs',
    cat: 'players',
    def: 'Financial corporations where the government owns the majority of capital — including the GSIS and SSS, which hold the public’s pension contributions.',
  },
  {
    term: 'Government Instrumentalities with Corporate Powers',
    aka: 'GICP · GCE',
    cat: 'players',
    def: 'Agencies that are neither corporations nor regular departments but hold corporate powers by law and administer special funds — airport and port authorities, deposit insurance, water utilities.',
  },
  {
    term: 'Local Government Units',
    aka: 'LGUs',
    cat: 'players',
    def: 'The provinces, cities, municipalities, and barangays — funded by their own revenues plus the automatic National Tax Allotment and other national transfers.',
  },
  {
    term: 'Head of Agency',
    cat: 'players',
    def: 'The accountable officer at the top of a department, bureau, agency, or instrumentality — the signature on which budget accountability legally hangs.',
  },
  {
    term: 'Public Sector',
    cat: 'players',
    def: 'The national government, government corporations, local governments, social security institutions, and the central bank taken together — the full perimeter of public money, wider than the national budget.',
  },
  {
    term: 'Private Sector',
    cat: 'players',
    def: 'Everyone who is not government — in the DBM’s definition, explicitly including NGOs, people’s organizations, cooperatives, civic clubs, and plain citizens.',
  },
  {
    term: 'Civil Society Organization',
    aka: 'CSO',
    cat: 'players',
    def: 'A non-state, non-profit association working to improve society — NGOs, people’s organizations, cooperatives, social movements, professional groups. The organized form citizen participation usually takes.',
  },
  {
    term: 'Non-Governmental Organization',
    aka: 'NGO',
    cat: 'players',
    def: 'A private, non-profit voluntary organization committed to socio-economic development and service — a basic type of civil society organization.',
  },
  {
    term: 'Permanent Committee',
    cat: 'players',
    def: 'The Finance Secretary, Budget Secretary, and COA Chairperson sitting as one body — monitoring all funds outside the General Fund and recommending reversions of amounts no longer needed.',
  },
  {
    term: 'Regional Development Council',
    aka: 'RDC',
    cat: 'players',
    def: 'The primary institution coordinating development efforts in each region — the forum where local plans are integrated with national ones.',
  },
  {
    term: 'Local Development Council',
    aka: 'LDC',
    cat: 'players',
    def: 'The council assisting each Sanggunian in setting economic and social direction — provincial, city, municipal, and barangay development councils. By law, a quarter of their members come from civil society.',
  },
  {
    term: 'Authorized Government Depository Bank',
    aka: 'AGDB',
    cat: 'players',
    def: 'A bank where government entities are allowed by law to deposit public funds and keep depository accounts.',
  },
  {
    term: 'Authorized Government Servicing Banks',
    aka: 'AGSBs',
    cat: 'players',
    def: 'The banks — Land Bank, DBP, Philippine Veterans Bank — through which cash allocations are credited and government payments actually clear.',
  },
  {
    term: 'Pag-IBIG Fund',
    aka: 'HDMF',
    cat: 'players',
    def: 'The Home Development Mutual Fund — the government financial institution mobilizing provident savings primarily for housing finance.',
  },
  // ---- revenue & the economy ----
  {
    term: 'Revenue',
    cat: 'revenue',
    def: 'Everything collected: taxes from the BIR, Customs, and other collecting offices, plus non-tax sources like fees and charges, grants, and privatization proceeds.',
  },
  {
    term: 'Tax Revenues',
    cat: 'revenue',
    def: 'Compulsory charges imposed by government on goods, services, transactions, individuals, and entities, arising from the sovereign power of the state — no service rendered in exchange required.',
  },
  {
    term: 'Non-Tax Revenues',
    cat: 'revenue',
    def: 'Collections that aren’t taxes: fees and charges for services, income from regulation and investments, hospital and tuition income, and proceeds from selling government assets.',
  },
  {
    term: 'Fees and Charges',
    cat: 'revenue',
    def: 'Amounts collected for administrative and regulatory services — passport fees, driver’s licenses, court fees, building permits — and payments exacted in exchange for goods and services.',
  },
  {
    term: 'Tax on Income and Profits',
    cat: 'revenue',
    def: 'Tax on all yearly income, emoluments, and profits — from property, profession, trade, or office — of individuals, partnerships, and corporations.',
  },
  {
    term: 'Tax on Domestic Goods and Services',
    cat: 'revenue',
    def: 'Tax levied on the domestic production, extraction, sale, transfer, leasing, use, or delivery of goods and the rendering of services — VAT’s home category.',
  },
  {
    term: 'Excise Tax',
    cat: 'revenue',
    def: 'Tax on specific goods manufactured in or imported into the country for domestic sale — fuel, tobacco, alcohol, sweetened drinks — either per unit or as a share of value.',
  },
  {
    term: 'Indirect Tax',
    cat: 'revenue',
    def: 'Tax levied on goods and services rather than directly on income — excise, sales tax, VAT, import duties, documentary stamps. Paid by whoever ends up buying.',
  },
  {
    term: 'Franchise Taxes',
    cat: 'revenue',
    def: 'Taxes on the special privilege the state confers on a person or corporation — like the right to operate a public utility.',
  },
  {
    term: 'Property Taxes',
    cat: 'revenue',
    def: 'Taxes on the ownership of wealth or immovable property, levied at regular intervals, and on transfers of real or personal property.',
  },
  {
    term: 'Transfer Taxes',
    cat: 'revenue',
    def: 'Taxes on property changing hands — by sale, donation, or inheritance.',
  },
  {
    term: 'Import Duties and Taxes',
    cat: 'revenue',
    def: 'Levies on goods entering the country — protecting locally-made equivalents and raising revenue at the border.',
  },
  {
    term: 'Earmarked Revenues',
    cat: 'revenue',
    def: 'Revenues a statute requires to be used for designated purposes and accounted for separately from the government’s general revenues — money with its destination written into law.',
  },
  {
    term: 'Existing Revenue Measures',
    cat: 'revenue',
    def: 'What current tax law already yields: collections under the tax code and customs law as they stand, before any proposed new measures.',
  },
  {
    term: 'Revenue Program',
    cat: 'revenue',
    def: 'The collection targets set for the tax and non-tax accounts of collecting agencies — the income side of the budget’s arithmetic.',
  },
  {
    term: 'Income from Public Enterprises and Investments',
    cat: 'revenue',
    def: 'What the government earns from its properties and investments — dividends, interest, rent, and royalties.',
  },
  {
    term: 'Dividends',
    cat: 'revenue',
    def: 'The share of government corporations’ declared net earnings remitted to the national government, at a rate prescribed by law.',
  },
  {
    term: 'Receipts',
    cat: 'revenue',
    def: 'Revenues plus gross borrowings for a period — everything that came in, from whatever source.',
  },
  {
    term: 'Resources',
    cat: 'revenue',
    def: 'In budgeting: revenues, gross borrowings, and free or unencumbered cash balances — the full set of what the government can spend from.',
  },
  {
    term: 'Grants and Donations',
    cat: 'revenue',
    def: 'Assistance in cash or in kind from foreign governments, institutions, or individuals for specific projects — with no obligation to repay.',
  },
  {
    term: 'Commodity Grants',
    cat: 'revenue',
    def: 'Donations received as goods rather than cash, subsequently monetized, with the peso proceeds spent on the projects specified in the grant documents.',
  },
  {
    term: 'Gross Domestic Product',
    aka: 'GDP',
    cat: 'revenue',
    def: 'The total value of goods and services produced in the country over a period. The budget’s favorite denominator: spending, deficit, and debt are all judged as shares of it.',
  },
  {
    term: 'Gross National Income',
    aka: 'GNI',
    cat: 'revenue',
    def: 'GDP plus income residents earn from abroad, minus income paid to non-residents — production by Filipinos rather than production in the Philippines.',
  },
  {
    term: 'Inflation',
    cat: 'revenue',
    def: 'The increase in the average price of goods and services over time. The quiet variable that decides whether a “bigger” budget actually buys more.',
  },
  {
    term: 'Balance of Payments',
    aka: 'BOP',
    cat: 'revenue',
    def: 'The summary of a country’s economic transactions with the rest of the world for a period — trade, income, investment, all in one statement.',
  },
  {
    term: 'Current Account',
    cat: 'revenue',
    def: 'The trade-and-income slice of the balance of payments: goods, services, and primary and secondary income. In surplus, the country lends to the world; in deficit, it borrows.',
  },
  {
    term: 'Trade Balance',
    cat: 'revenue',
    def: 'Exports minus imports of goods — a surplus when export shipments exceed import arrivals, a deficit when the reverse.',
  },
  {
    term: 'Exports',
    cat: 'revenue',
    def: 'All goods leaving the country, properly cleared through Customs (services counted separately).',
  },
  {
    term: 'Imports',
    cat: 'revenue',
    def: 'All goods entering the country through seaports or airports, cleared through Customs with duties and taxes paid before legal release.',
  },
  {
    term: 'Capital Inflows',
    cat: 'revenue',
    def: 'Private and official money flowing into the country as investments, grants, and loans.',
  },
  {
    term: 'Net Income',
    cat: 'revenue',
    def: 'Revenues minus expenses for a corporation over a period — positive is net income, negative is a net loss.',
  },
  {
    term: 'Equity',
    cat: 'revenue',
    def: 'The national government’s capital investment in its corporations — payment of capital subscriptions that forms part of their capitalization.',
  },
  {
    term: 'Consolidated Public Sector Financial Position',
    aka: 'CPSFP',
    cat: 'revenue',
    def: 'The combined balances of the national government, monitored corporations, financial institutions, local governments, social security institutions, and the central bank — the whole public sector’s bottom line in one figure.',
  },
  // ---- debt & borrowings ----
  {
    term: 'Borrowings',
    cat: 'debt',
    def: 'Funds obtained from repayable sources — loans from financial institutions and securities issued — to finance projects or support the budget. Domestic or foreign.',
  },
  {
    term: 'Domestic Borrowings',
    cat: 'debt',
    def: 'Funds borrowed within the country, mostly through Treasury bills and bonds issued by the Bureau of the Treasury.',
  },
  {
    term: 'Foreign Borrowings',
    cat: 'debt',
    def: 'Funds borrowed abroad — from the Asian Development Bank, World Bank, JICA, and other lenders.',
  },
  {
    term: 'Public Debt',
    cat: 'debt',
    def: 'The total indebtedness of the government — private or government creditors, foreign or domestic — fully supported and guaranteed by the national government.',
  },
  {
    term: 'Outstanding Debt',
    cat: 'debt',
    def: 'Accumulated borrowings that remain unpaid as of a given date — the stock, where the deficit is the flow.',
  },
  {
    term: 'Debt Amortization',
    cat: 'debt',
    def: 'The principal payments on loans payable in regular installments — paying the debt itself down, as distinct from paying interest on it.',
  },
  {
    term: 'Principal Payment',
    cat: 'debt',
    def: 'Total cash outlays from the Treasury for redeeming maturing debt securities and obligations.',
  },
  {
    term: 'Interest',
    cat: 'debt',
    def: 'The charge for the use of borrowed money. Interest on the national debt is automatically appropriated — the single biggest budget item Congress never votes on.',
    see: { to: '/2027/d/AUTO', label: 'See debt interest in the FY 2027 NEP' },
  },
  {
    term: 'Commitment Fee',
    cat: 'debt',
    def: 'What the borrower pays the lender on the undisbursed portion of a loan — a fee for money contracted but not yet drawn.',
  },
  {
    term: 'Treasury Bills',
    cat: 'debt',
    def: 'Short-term debt instruments issued by the national government — maturing within a year.',
  },
  {
    term: 'Treasury Bonds',
    cat: 'debt',
    def: 'Certificates of indebtedness issued by the national government maturing beyond one year — the long half of domestic borrowing.',
  },
  {
    term: 'Government Securities',
    cat: 'debt',
    def: 'Evidence of indebtedness of the Republic or its instrumentalities — freely negotiable, and required to be regularly serviced.',
  },
  {
    term: 'Bond Exchange',
    aka: 'bond swap',
    cat: 'debt',
    def: 'Converting existing public debt securities into new instruments with longer maturities and better terms — managing the debt’s shape without new net borrowing.',
  },
  {
    term: 'Official Development Assistance',
    aka: 'ODA',
    cat: 'debt',
    def: 'Loans or grants from partner governments and multilateral institutions to promote development and welfare — qualifying only if the terms include a grant element of at least twenty-five percent.',
  },
  {
    term: 'Program Loan',
    cat: 'debt',
    def: 'A foreign loan for general budget support, disbursed as the government meets agreed conditions or milestones rather than tied to a specific project.',
  },
  {
    term: 'Project Loan',
    cat: 'debt',
    def: 'A foreign loan financing a specific development project, released for eligible expenditures on a disbursement schedule and requiring appropriations cover.',
  },
  {
    term: 'Commodity Loans',
    cat: 'debt',
    def: 'Foreign loans received as goods, subsequently monetized, with the peso proceeds spent on projects specified in the loan documents.',
  },
  {
    term: 'Relent Loans',
    cat: 'debt',
    def: 'Loans the national government contracts directly and then lends onward to government corporations, financial institutions, or local governments.',
  },
  {
    term: 'Direct National Government Loans',
    cat: 'debt',
    def: 'Loans, domestic or foreign, contracted directly by the national government itself.',
  },
  {
    term: 'Loan Availments',
    aka: 'loan proceeds',
    cat: 'debt',
    def: 'Amounts actually drawn against loan commitments — in cash or in kind — usable for items in the GAA the lender agrees to and deems eligible.',
  },
  {
    term: 'GOP Counterpart',
    cat: 'debt',
    def: 'The Philippine government’s own share of a foreign-assisted project’s cost — its contribution to completion as stipulated in the loan or grant agreement.',
  },
  {
    term: 'Guaranteed Obligations',
    cat: 'debt',
    def: 'Debts where the government stands as guarantor: if the primary borrower fails to pay, the Republic becomes liable.',
  },
  {
    term: 'Contingent Liabilities',
    cat: 'debt',
    def: 'Obligations that may or may not come due depending on events — guarantees to government corporations, insurance liabilities, and clauses in PPP contracts. Real exposure, invisible in the headline budget.',
  },
  {
    term: 'Assumed Liabilities',
    cat: 'debt',
    def: 'Loans and securities originally contracted by government corporations or financial institutions that by law have been transferred onto the national government’s books.',
  },
  {
    term: 'Financing',
    cat: 'debt',
    def: 'How a government covers a deficit or allocates a surplus — the borrowing side of the budget equation.',
  },
  {
    term: 'Financing Requirement',
    cat: 'debt',
    def: 'The amount needed to cover the deficit, debt amortization, and cash buffers not covered by revenue — what must be borrowed.',
  },
  {
    term: 'Public Sector Borrowing Requirement',
    aka: 'PSBR',
    cat: 'debt',
    def: 'The national government’s deficit plus the monitored corporations’ deficits, less the budgetary assistance already flowing to those corporations — how much the whole public sector must borrow.',
  },
  {
    term: 'Public-Private Partnership',
    aka: 'PPP',
    cat: 'debt',
    def: 'A contract where a private partner finances, builds, or operates infrastructure or services typically provided by the public sector, sharing risks, with the partner’s returns linked to performance.',
  },
  {
    term: 'Conversion of Advances to Equity',
    cat: 'debt',
    def: 'The mechanism converting unpaid national government advances — made to service a struggling corporation’s debts — into government equity or subsidy in that corporation.',
  },
  {
    term: 'Special Drawing Rights',
    aka: 'SDR',
    cat: 'debt',
    def: 'Reserve assets created by the International Monetary Fund to supplement countries’ reserves — assets with no corresponding liability.',
  },
  {
    term: 'SOFR',
    aka: 'Secured Overnight Financing Rate',
    cat: 'debt',
    def: 'The benchmark interest rate for dollar-denominated loans that replaced LIBOR — based on actual secured transactions, which makes it harder to manipulate.',
  },
  // ---- accountability & performance ----
  {
    term: 'Budget and Financial Accountability Reports',
    aka: 'BFARs',
    cat: 'oversight',
    def: 'The harmonized reports on what agencies actually spent and accomplished versus their plans and targets — prescribed by the DBM and COA, and the paper trail an execution-phase watcher reads.',
  },
  {
    term: 'Agency Performance Review',
    aka: 'APR',
    cat: 'oversight',
    def: 'The process of measuring each agency’s physical outputs, outcomes, and actual expenditures against its targets and budgets for the same period.',
  },
  {
    term: 'Performance Indicator',
    aka: 'PI',
    cat: 'oversight',
    def: 'The measurable evidence of how an agency delivers: quantity, quality, or timeliness of outputs and outcomes. Output indicators track what an agency controls; outcome indicators track whether the program achieved its objective.',
  },
  {
    term: 'Performance Target',
    cat: 'oversight',
    def: 'A predetermined level of quantity, quality, timeliness, and cost of outputs — the number the indicator is judged against.',
  },
  {
    term: 'Target',
    cat: 'oversight',
    def: 'The goal or specific objective of a program — the shortest definition in the DBM’s glossary, and the hardest thing to pin down in practice.',
  },
  {
    term: 'Output',
    cat: 'oversight',
    def: 'Any good or service an agency delivers to a target population external to itself — what the money directly bought.',
  },
  {
    term: 'Outcome',
    cat: 'oversight',
    def: 'The change or result a program brings about in people, social structures, or the physical environment — what the money was actually for.',
  },
  {
    term: 'Organizational Outcome',
    aka: 'OO',
    cat: 'oversight',
    def: 'The short-to-medium-term result an agency is accountable for producing through its programs — the level at which agency budgets are structured under program budgeting.',
  },
  {
    term: 'Performance-Based Bonus',
    aka: 'PBB',
    cat: 'oversight',
    def: 'The top-up incentive government employees receive based on their agency hitting its targets and commitments — performance pay, with criteria set each year.',
  },
  {
    term: 'PhilGEPS',
    aka: 'Philippine Government Electronic Procurement System',
    cat: 'oversight',
    def: 'The single electronic portal for all government procurement — every bid opportunity and registered supplier in one searchable system. Where budget scrutiny meets procurement scrutiny.',
  },
  {
    term: 'National Government Cash Operations Report',
    aka: 'COR',
    cat: 'oversight',
    def: 'The Treasury’s report on actual cash receipts and disbursements, the resulting surplus or deficit, and how it was financed — the budget as it actually happened, in cash.',
  },
  {
    term: 'Projection',
    cat: 'oversight',
    def: 'Data approximating future events, derived from statistical or econometric tools. Every budget number for a year that hasn’t happened yet is one.',
  },
];
