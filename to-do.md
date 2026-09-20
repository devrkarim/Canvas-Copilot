- add read syllabus feature
- fix sync button slow
- add extension feature
- finish up plume submission
- chatbot resetting when changing tabs (implement persistence)

- syllabus just grabs the first file link and trusts a 1,500-character length threshold.
    - prefer a link whose filename contains "syllabus" when there are several — free, no model.
    - have the existing PDF transcription call also report whether it's really a syllabus — free, catches what filenames miss.
    - if it isn't, try the next link — makes the pick self-correcting instead of first-match-wins.