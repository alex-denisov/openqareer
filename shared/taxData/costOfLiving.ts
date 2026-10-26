import type { CountryTaxData, TaxDataSource } from './types';

export const numbeoTerms: TaxDataSource = {
  title: 'Numbeo: коммерческое использование требует лицензии',
  url: 'https://www.numbeo.com/common/terms_of_use.jsp',
  dataYear: 2026,
  retrievedAt: '2026-10-10',
};

/** No open, verified monthly rent set exists; private insurance depends on the plan and age. */
export const unavailableCostOfLiving: CountryTaxData['costOfLiving'] = {
  monthlyRent: null,
  monthlyPrivateHealthInsurance: null,
  unavailableReason:
    'Нет проверенного открытого набора ежемесячной аренды. Коммерческие данные Numbeo не включены без лицензии; частный страховой тариф зависит от плана и возраста.',
  licensingSource: numbeoTerms,
};
