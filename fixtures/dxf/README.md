# DXF import regression fixture

`bulged-rounded-plate.dxf` is an original synthetic millimetre drawing: a 60 × 40 mm plate with 5 mm corner radii and a centered 10 mm diameter hole. The outer outline mixes straight segments and four quarter-circle bulges; the final bulge closes the outline. The hole consists of two semicircle bulges, including its closing segment.

DXF group 42 is interpreted according to [Autodesk's VERTEX reference](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DXF/files/GUID-0741E831-599E-4CBF-91E1-8ADBCFD6556D.htm). The importer expands each bulged segment into the editor's line-segment contour representation with a maximum chord deviation of 0.08 mm in physical units. It keeps the original file untouched.

Automated checks cover both LWPOLYLINE and classic POLYLINE, positive/negative bulges, major arcs, closing arcs, holes, inch conversion, negative-Z extrusion, negligible bulges and malformed/overly dense curves. Curves requiring more than 20,000 points per contour fail with a specific diagnostic rather than silently reducing accuracy.
