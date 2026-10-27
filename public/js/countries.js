// Country -> flag code (flagcdn.com) and continent. Same continent = yellow tile.
const C = (code, continent) => ({ code, continent });
const EU = 'Europe', AS = 'Asia', AF = 'Africa', NA = 'North America', SA = 'South America', OC = 'Oceania';

export const COUNTRIES = {
  // North America, Central America & Caribbean
  USA: C('us', NA), Canada: C('ca', NA), Mexico: C('mx', NA), Cuba: C('cu', NA), 'Dominican Republic': C('do', NA),
  'Puerto Rico': C('pr', NA), Jamaica: C('jm', NA), Haiti: C('ht', NA), 'Trinidad and Tobago': C('tt', NA), Anguilla: C('ai', NA), Aruba: C('aw', NA),
  Panama: C('pa', NA), 'Costa Rica': C('cr', NA), Guatemala: C('gt', NA), Honduras: C('hn', NA), 'El Salvador': C('sv', NA), Nicaragua: C('ni', NA),
  // South America
  Brazil: C('br', SA), Argentina: C('ar', SA), Chile: C('cl', SA), Peru: C('pe', SA), Colombia: C('co', SA), Ecuador: C('ec', SA),
  Venezuela: C('ve', SA), Bolivia: C('bo', SA), Paraguay: C('py', SA), Uruguay: C('uy', SA), Suriname: C('sr', SA), Guyana: C('gy', SA),
  // Europe
  England: C('gb-eng', EU), Scotland: C('gb-sct', EU), Wales: C('gb-wls', EU), 'Northern Ireland': C('gb-nir', EU), Ireland: C('ie', EU),
  France: C('fr', EU), Germany: C('de', EU), Netherlands: C('nl', EU), Belgium: C('be', EU), Switzerland: C('ch', EU), Austria: C('at', EU),
  Italy: C('it', EU), Spain: C('es', EU), Portugal: C('pt', EU), Poland: C('pl', EU), 'Czech Republic': C('cz', EU), Slovakia: C('sk', EU),
  Hungary: C('hu', EU), Romania: C('ro', EU), Bulgaria: C('bg', EU), Moldova: C('md', EU), Ukraine: C('ua', EU), Belarus: C('by', EU),
  Russia: C('ru', EU), Lithuania: C('lt', EU), Latvia: C('lv', EU), Estonia: C('ee', EU), Finland: C('fi', EU), Sweden: C('se', EU),
  Norway: C('no', EU), Denmark: C('dk', EU), Iceland: C('is', EU), Croatia: C('hr', EU), Serbia: C('rs', EU), Slovenia: C('si', EU),
  'Bosnia and Herzegovina': C('ba', EU), Montenegro: C('me', EU), Albania: C('al', EU), Kosovo: C('xk', EU), 'North Macedonia': C('mk', EU),
  Greece: C('gr', EU), Cyprus: C('cy', EU),
  // Asia & Middle East
  Georgia: C('ge', AS), Armenia: C('am', AS), Azerbaijan: C('az', AS), Turkey: C('tr', AS), Kazakhstan: C('kz', AS), Kyrgyzstan: C('kg', AS),
  Uzbekistan: C('uz', AS), Tajikistan: C('tj', AS), Turkmenistan: C('tm', AS), Afghanistan: C('af', AS), Iran: C('ir', AS), Iraq: C('iq', AS),
  Israel: C('il', AS), Palestine: C('ps', AS), Lebanon: C('lb', AS), Jordan: C('jo', AS), Syria: C('sy', AS), 'Saudi Arabia': C('sa', AS), 'United Arab Emirates': C('ae', AS),
  Bahrain: C('bh', AS), India: C('in', AS), Pakistan: C('pk', AS), China: C('cn', AS), Mongolia: C('mn', AS), Japan: C('jp', AS),
  'South Korea': C('kr', AS), Taiwan: C('tw', AS), Philippines: C('ph', AS), Thailand: C('th', AS), Vietnam: C('vn', AS), Myanmar: C('mm', AS),
  'Hong Kong': C('hk', AS), Indonesia: C('id', AS), Malaysia: C('my', AS), Singapore: C('sg', AS),
  // Africa
  Nigeria: C('ng', AF), Cameroon: C('cm', AF), 'DR Congo': C('cd', AF), 'Democratic Republic of the Congo': C('cd', AF), Congo: C('cg', AF),
  Ghana: C('gh', AF), Guinea: C('gn', AF), Senegal: C('sn', AF), 'Ivory Coast': C('ci', AF), 'South Africa': C('za', AF), Angola: C('ao', AF), Uganda: C('ug', AF),
  Kenya: C('ke', AF), Ethiopia: C('et', AF), Tanzania: C('tz', AF), Zimbabwe: C('zw', AF), Zambia: C('zm', AF), Morocco: C('ma', AF),
  Algeria: C('dz', AF), Tunisia: C('tn', AF), Egypt: C('eg', AF), 'Cape Verde': C('cv', AF),
  // Oceania
  Australia: C('au', OC), 'New Zealand': C('nz', OC), Fiji: C('fj', OC), Samoa: C('ws', OC), Tonga: C('to', OC), Guam: C('gu', OC),
  'Papua New Guinea': C('pg', OC),
};
