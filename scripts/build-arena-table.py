import bpy, math, os, random
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
random.seed(43)
target=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),'src','three','assets','arena-table.glb')
def mat(name,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(0.25,0.14,0.065,1);m.use_nodes=True
 s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=m.diffuse_color;s.inputs['Roughness'].default_value=0.8;s.inputs['Metallic'].default_value=metal
 return m
woods=[mat('wood-'+str(i)) for i in range(4)]
brass=mat('brass',0.65);iron=mat('iron',0.75);wax=mat('wax');ale=mat('ale');flame=mat('flame')
def finish(name,m,bevel=0):
 o=bpy.context.object;o.name=name;o.data.materials.append(m)
 if bevel:
  bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  mod=o.modifiers.new('Worn edges','BEVEL');mod.width=bevel;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
def block(name,loc,size,m,bevel=0.035):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);bpy.context.object.dimensions=size;return finish(name,m,bevel)
def cylinder(name,loc,r,d,m):
 bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=r,depth=d,location=loc);return finish(name,m,0.01)
def torus(name,loc,r,t,m,rotation=(0,0,0)):
 bpy.ops.mesh.primitive_torus_add(major_segments=24,minor_segments=8,location=loc,major_radius=r,minor_radius=t,rotation=rotation);return finish(name,m)
for row in range(10):
 board=block('Old oak plank',(0,(row-4.5)*2.49,-0.3),(24.2-random.random()*0.025,2.465,0.28),woods[row%4],0.028)
 uv=board.data.uv_layers.active.data
 for poly in board.data.polygons:
  for li in poly.loop_indices:
   v=board.data.vertices[board.data.loops[li].vertex_index].co
   uv[li].uv=(v.x/24.2+0.5,v.y/2.465+0.5)
 for edge in [-1,1]:
  for offset in [-0.73,0.73]:cylinder('Forged nail',(edge*11.8,(row-4.5)*2.49+offset,-0.15),0.037,0.012,iron)
for side in [-1,1]:
 block('Worn oak rim',(side*12.25,0,-0.16),(0.35,25.15,0.5),woods[0],0.1)
 block('End grain rim',(0,side*12.6,-0.16),(24.8,0.35,0.5),woods[1],0.1)
 for y in [-11,0,11]:block('Iron brace',(side*12.25,y,0.105),(0.35,0.2,0.035),iron,0.02)
for x,y,h in [(-11,0,0.85),(-10.8,0.7,0.55),(11,2.4,1.05)]:
 cylinder('Candle saucer',(x,y,-0.08),0.4,0.12,brass);torus('Saucer lip',(x,y,-0.015),0.36,0.04,brass)
 cylinder('Beeswax candle',(x,y,h/2),0.17,h,wax)
 for j in range(4):
  a=j*1.7;cylinder('Wax drip',(x+math.cos(a)*0.15,y+math.sin(a)*0.15,h-0.1-j*0.04),0.04,0.18,wax)
 cylinder('Charred wick',(x,y,h+0.035),0.018,0.1,iron)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=(x,y,h+0.17));bpy.context.object.scale=(0.065,0.065,0.16);finish('Candle flame',flame)
x,y=10.9,6.2
cylinder('Tankard body',(x,y,0.35),0.42,0.95,woods[2]);cylinder('Dark ale',(x,y,0.831),0.36,0.012,ale)
for h in [-0.06,0.72,0.84]:torus('Pewter band',(x,y,h),0.415,0.045,iron)
torus('Tankard handle',(x+0.52,y,0.35),0.3,0.065,iron,(math.pi/2,0,0))
for j in range(7):
 x,y=-10.7+random.uniform(-0.4,0.4),-2.7+random.uniform(-0.45,0.45)
 cylinder('Scattered coin',(x,y,-0.12+j*0.004),0.105,0.035,brass);torus('Coin rim',(x,y,-0.099+j*0.004),0.085,0.008,brass)
for m in woods+[brass,iron,wax,ale,flame]:
 bpy.ops.object.select_all(action='DESELECT')
 objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.data.materials[0]==m]
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
bpy.ops.object.select_all(action='SELECT')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=target.replace('.glb','.blend'))
bpy.ops.export_scene.gltf(filepath=target,export_format='GLB',use_selection=True)

