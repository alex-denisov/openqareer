// The page's styles ride in its lazy chunk, off the first-paint sheet; the
// prerender imports the page itself, which Node can load without CSS.
import './salaryCalculatorPage.css';

export { SalaryCalculatorPage } from './SalaryCalculatorPage';
