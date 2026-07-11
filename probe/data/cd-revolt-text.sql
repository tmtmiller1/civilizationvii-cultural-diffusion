-- LOC strings for the hidden revolt-marker constructible. It is hidden, so these never display;
-- they exist only so the Constructibles/ConstructibleClasses rows have valid Name/Description tags.
INSERT OR REPLACE INTO LocalizedText (Language, Tag, Text) VALUES
    ('en_US', 'LOC_CD_HIDDEN_CLASS_NAME', 'Cultural Diffusion Hidden'),
    ('en_US', 'LOC_CD_HIDDEN_CLASS_DESC', 'Hidden cultural-diffusion marker class.'),
    ('en_US', 'LOC_BUILDING_CD_REVOLT_MARKER_NAME', 'Cultural Revolt'),
    ('en_US', 'LOC_BUILDING_CD_REVOLT_MARKER_DESC', 'A settlement overwhelmed by cultural pressure.'),
    ('en_US', 'LOC_BUILDING_CD_REVOLT_MARKER_TOOLTIP', 'Hidden cultural revolt marker.');
