<!--{"parent": "11_Rendering.md", "order": 1}-->

## The Camera Object

![](/images/pastedGraphic-539.jpg)

*When selected, a camera appears in the 3D view as a wireframe movie camera with a pyramid coming out of it indicating its field of view.*

![](/images/pastedGraphic-540.jpg)

*The camera object has many properties, and they’re all important.*

> **Note:** this screenshot shows an older version of Cheetah 3D. <!-- TODO screenshot -->

The first thing to notice about a camera object is that like meshes, it has **position** and **rotation** properties, but unlike meshes (and like other non-mesh objects, such as lights) it does not have scale properties.

Usually the most convenient way to place and orient a camera is by making it the active camera and then modifying your point of view while looking “through it” (i.e. setting your 3D view to “Camera” and altering the view directly.)

> **Note:** Cheetah 3D 8.1.1 also has depth of field and motion blur settings on the camera (**Aperture size**, **Aperture blades**, **Aperture rotation**, **Focal distance**, **Focus object**, **Display DOF-Grid**, **Shutter time**), which work with the renderers’ Depth of field and Motion blur (Falcon) checkboxes; not yet covered here (manual: Objects › Camera, Render › Falcon). <!-- TODO missing -->
