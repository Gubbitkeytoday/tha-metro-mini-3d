/** A 3D geographic coordinate: [longitude, latitude, altitude_meters] (SRS §F1.3). */
export type LngLatAlt = [number, number, number];

export interface Station {
  id: number | string;
  name: string;
  nameTh: string;
  code: string;
  position: LngLatAlt;
}

export interface LineBranch {
  name: string;
  color: string;
  relationId: number;
  osmName: string;
  track: LngLatAlt[];
  stations: Station[];
}

export interface GreenLineData {
  generated: string;
  source: string;
  line: string;
  branches: {
    sukhumvit: LineBranch;
    silom: LineBranch;
  };
}
