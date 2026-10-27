// /faq and /tariffs share one lazy chunk: their styles ride in it, off the
// first-paint sheet, and the prerendered documents link that stylesheet. The
// prerender imports the pages themselves, which Node loads without CSS.
import './publicDocs.css';
import './faqPage.css';
import './tariffsPage.css';

export { FaqPage } from './FaqPage';
export { TariffsPage } from './TariffsPage';
