# Offshore energy in God’s Eye

1. Open **Maritime layers** in the maritime workspace.
2. Turn on **Oil & Gas Installations** or **Offshore Wind Farms**. Both can be displayed with AIS and weather.
3. Open **Offshore energy — search & details**. Search by installation name, operator, or country, then select a result to fly to it. You can also click a marker or wind-farm area on the globe.
4. Read the information card for the published status, operator, coordinates, source, and available data dates. Wind farms can include capacity and turbine count. Oil installations can include water depth.
5. Select **Show AIS around this site** to enable the existing AIS layer and center the map on the site. Vessel availability still depends on the configured AIS providers.

Operating sites appear by default. Use the status menus beside the search, or the controls in **Data Layers → Infrastructure**, to select **Planned / Building**, **Retired**, or **All Statuses** to change the view. **Include Subsea** adds the Norwegian register’s subsea facilities. Status filters are saved independently for each layer and included in shared links. Unknown statuses appear only under **All Statuses**.

Oil and gas installations are amber; wind farms are teal. Farm boundaries are drawn where the source provides polygons. A farm marker represents a farm, not the exact location of each turbine. The map covers Northern Europe within 48–82°N and 20°W–40°E.

## Sources and freshness

- Norway: Norwegian Offshore Directorate, FactMaps facilities register. Onshore facilities, landfalls, and wind turbines are excluded from the oil layer.
- UK: North Sea Transition Authority, surface infrastructure register, including platforms and FPSOs.
- Additional countries: EMODnet Human Activities / Cogea offshore installations. The catalog’s listed revision is February 16, 2024. Norway and UK use their national registers when available; EMODnet fills those countries only if their national source is unavailable.
- Wind farms: EMODnet Human Activities / CETMAR, points and polygons. The catalog’s listed revision is July 10, 2026. Point/area representations with matching names, countries, and status categories are combined into one searchable farm. Different named phases remain separate.

**Sources & data dates** shows which providers responded and when the app fetched their data. Fetch time does not mean the provider updated every record at that time. A published dataset revision and an individual record’s update date are different and are labeled separately.

These are asset registers, not live production or rig-position feeds. Moving rigs need additional AIS information where available. Do not interpret a register’s “Operating” status as confirmation of activity right now.

The server queries fixed public APIs without an API key. It caches responses for six hours and combines concurrent requests. If refresh fails, a cached source may remain visible for up to seven days and is labeled as cached. A failed source is reported as unavailable or partial, rather than appearing as a successful empty feed. Login is required for the data endpoint.

## Attribution

Norwegian Offshore Directorate: NLOD 2.0, [open data](https://www.sodir.no/fakta/data-og-analyser/apne-data/).

North Sea Transition Authority: [infrastructure open data](https://www.nstauthority.co.uk/data-and-insights/data/themes/infrastructure/).

EMODnet Human Activities: CC BY 4.0; Cogea for [offshore installations](https://emodnet.ec.europa.eu/geonetwork/srv/api/records/ddbe3597-4e3f-4e74-8d31-947c4efef2e9), CETMAR for [wind farms](https://emodnet.ec.europa.eu/geonetwork/srv/api/records/8201070b-4b0b-4d54-8910-abcea5dce57f).
