# NorSaga data-source review

Initial inventory: 24 September 2026, based on the copied repository's `LICENSE`,
`DATA_SOURCES.md`, `THIRD_PARTY_NOTICES.md` and per-asset notices. This is an
engineering review queue, not a legal opinion or confirmation of provider rights.
Verify current provider terms and the intended NorSaga use before release.

**The source code and the data are not covered by the same license.** No dataset
has been commercially cleared by this customization. Original bundled data is
retained for baseline compatibility, so this branch is not ready for commercial
redistribution or public customer deployment.

| Source / asset | Repository's recorded position | Required release action |
| --- | --- | --- |
| God's Eye View source | MIT, copyright Bilawal Sidhu | Retain copyright and permission notices in distributed copies |
| TeleGeography bundled cables | CC BY-NC-SA 3.0; non-commercial | Obtain suitable permission or remove/replace the dataset, public build artifacts and all references |
| Bhote Koshi imagery and derived coordinates | CC BY-NC 4.0 in documented datasets | Obtain permission or remove the event assets and derived dataset from commercial artifacts |
| OpenSky | Commercial/service restrictions recorded | Check agreement for the exact intended use; configure a permitted source |
| OpenStreetMap / infrastructure extracts | ODbL data obligations recorded | Assess attribution and derivative-database obligations |
| Google Maps / Cesium ion | Separate account, product and plan terms | Confirm commercial eligibility, quotas, billing, allowed domains and visible attribution |
| AISStream | Provider terms apply | Confirm redistribution, history storage, permitted use and service expectations |
| Weather, satellite imagery and forecast products | Per-source terms and coverage | Verify each enabled product, required credits and any service-plan restrictions |
| Public CCTV, radio, orbital and aircraft enrichment sources | Separate source terms | Review individually; public accessibility is not a blanket redistribution license |
| Bundled 3D models | Individual model licenses | Review `public/models/README.md` before distributing model files |

## Controls required before a commercial release

Track provider, product, use case, license URL, license version/review date,
permissions or agreement reference, retention limits, redistribution rights,
attribution text, owner, and approval status for each source. Unknown means not
approved. Keep credentials outside source control and logs.

Disabling a layer in the interface does not remove its data from the repository
or generated assets. A commercial build must exclude restricted files and
verify that they cannot still be fetched through a static URL. This release does
not implement that build filter and does not claim compliance by hiding controls.

The NorSaga maritime launch choices do not enable the bundled submarine-cable
or Nepal-event datasets. Those original capabilities remain elsewhere in the
application for evaluation and must be reviewed before distribution.

## Evidence in this repository

- [License and third-party-data warning](../LICENSE)
- [Detailed source inventory](../DATA_SOURCES.md)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)
- [3D-model notices](../public/models/README.md)
