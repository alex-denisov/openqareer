import { CareerTariffsView, type TariffTierId } from '../tariffs';
import { usePlanRequests, type PlanRequestId } from './planRequestApi';

/** Оплаты нет: выбор уровня записывается заявкой, команда напишет, когда оплата откроется. */
function requestFor(tier: TariffTierId): PlanRequestId {
  return tier === 'max' || tier === 'exec' ? 'consultant' : 'automation';
}

export function TariffsScreen() {
  const requests = usePlanRequests();
  const send = (tier: TariffTierId) => requests.send(requestFor(tier));
  return <CareerTariffsView activeTierId="free" onSelectTier={send} onRequestTier={send} />;
}
