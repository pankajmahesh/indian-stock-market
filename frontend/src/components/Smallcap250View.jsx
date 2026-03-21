import IndexPredictionView from './IndexPredictionView';
import { api } from '../api';

export default function Smallcap250View() {
  return (
    <IndexPredictionView
      title="Nifty Smallcap 250"
      description="Scans all Nifty Smallcap 250 stocks with real-time CMP and price predictions (7/30/90 day targets)."
      apiGet={api.getSmallcap250}
      apiScan={api.scanSmallcap250}
      apiStatus={api.getSmallcap250Status}
      apiLive={api.getSmallcap250Live}
    />
  );
}
