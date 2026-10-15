import { useSearchParams } from 'react-router';
import { beijingMonth, parseMonth } from '../../lib/dates.js';

/** The month a list shows, kept in the address so going back returns to the same month. */
export function useMonthParam(): [string, (month: string) => void] {
  const [params, setParams] = useSearchParams();
  const month = parseMonth(params.get('month')) ?? beijingMonth(new Date());
  return [month, (next) => setParams({ month: next }, { replace: true })];
}
