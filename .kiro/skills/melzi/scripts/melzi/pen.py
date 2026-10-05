"""A pen. Not a filter, not a texture: a stroke whose width varies along its length,
the way a real nib does. Every mark in the mascot is one of these, so the hand is in
the geometry and it survives being scaled to any size."""
import math

def catmull(pts, n=18):
    """Smooth centreline through the given points."""
    if len(pts) < 2: return list(pts)
    P = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(len(P)-3):
        p0,p1,p2,p3 = P[i],P[i+1],P[i+2],P[i+3]
        for j in range(n):
            t=j/n; t2=t*t; t3=t2*t
            out.append((
              0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
              0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)))
    out.append(pts[-1])
    return out

def _width(t, w0, w1, wmid, bias):
    """Pen pressure along the stroke. Light at the entry, full through the belly of the
    stroke, light again at the exit -- and `bias` moves where the belly sits, because a
    hand does not put its weight in the middle."""
    b = max(0.02, min(0.98, bias))
    u = (t/b) if t < b else (1-(t-b)/(1-b))
    u = max(0.0, min(1.0, u))
    e = u*u*(3-2*u)
    base = w0*(1-t) + w1*t
    return base + (wmid-base)*e

def pen(pts, w0=0.6, w1=0.6, wmid=2.2, bias=0.45, smooth=18, prec=2):
    """Return a filled path: the centreline offset either side by the pressure curve."""
    c = catmull(pts, smooth)
    n = len(c)
    left, right = [], []
    for i,(x,y) in enumerate(c):
        t = i/(n-1)
        if i==0: dx,dy = c[1][0]-x, c[1][1]-y
        elif i==n-1: dx,dy = x-c[-2][0], y-c[-2][1]
        else: dx,dy = c[i+1][0]-c[i-1][0], c[i+1][1]-c[i-1][1]
        L = math.hypot(dx,dy) or 1e-6
        nx,ny = -dy/L, dx/L
        w = _width(t, w0, w1, wmid, bias)/2
        left.append((x+nx*w, y+ny*w)); right.append((x-nx*w, y-ny*w))
    ring = left + right[::-1]
    d = f'M{ring[0][0]:.{prec}f} {ring[0][1]:.{prec}f}'
    for x,y in ring[1:]: d += f'L{x:.{prec}f} {y:.{prec}f}'
    return d + 'Z'

def dot(x, y, r, prec=2):
    k = 0.5523*r
    return (f'M{x:.{prec}f} {y-r:.{prec}f}'
            f'C{x+k:.{prec}f} {y-r:.{prec}f} {x+r:.{prec}f} {y-k:.{prec}f} {x+r:.{prec}f} {y:.{prec}f}'
            f'C{x+r:.{prec}f} {y+k:.{prec}f} {x+k:.{prec}f} {y+r:.{prec}f} {x:.{prec}f} {y+r:.{prec}f}'
            f'C{x-k:.{prec}f} {y+r:.{prec}f} {x-r:.{prec}f} {y+k:.{prec}f} {x-r:.{prec}f} {y:.{prec}f}'
            f'C{x-r:.{prec}f} {y-k:.{prec}f} {x-k:.{prec}f} {y-r:.{prec}f} {x:.{prec}f} {y-r:.{prec}f}Z')

def centreline(pts, smooth=18, prec=2):
    """The path a hand would actually travel. Stroking this with a dash animation and
    using it as a mask makes the ribbon appear the way it was drawn, in one pass."""
    c = catmull(pts, smooth)
    d = f'M{c[0][0]:.{prec}f} {c[0][1]:.{prec}f}'
    for x,y in c[1:]: d += f'L{x:.{prec}f} {y:.{prec}f}'
    return d

def polylen(pts, smooth=18):
    c = catmull(pts, smooth)
    return sum(math.hypot(c[i+1][0]-c[i][0], c[i+1][1]-c[i][1]) for i in range(len(c)-1))
