import { describe, expect, it } from 'vitest';
import { inspectionLimit, selectRootSitemap, jobPostingEvidence, publicGoogleError } from './google-seo-audit.mjs';

describe('bounded evidence-only Google audit', () => {
  it('caps inspection budget and rejects Infinity rather than inspecting every sitemap URL', () => {
    expect(inspectionLimit(undefined)).toBe(20);
    expect(inspectionLimit('0')).toBe(0);
    expect(inspectionLimit('50')).toBe(50);
    for (const value of ['Infinity','10000','-1','1.5','not-a-number'])
      expect(()=>inspectionLimit(value)).toThrow('integer from 0 to 50');
  });
  it('selects the exact root sitemap, never an old file or another host', () => {
    const target={path:'https://openqareer.com/sitemap.xml'};
    expect(selectRootSitemap([{path:'https://openqareer.com/old-sitemap.xml'}, {path:'https://other.example/sitemap.xml'},target])).toBe(target);
  });
  it('finds nested graph postings and accepts real remote location evidence', () => {
    const posting={'@type':'JobPosting',title:'Engineer',description:'Real text',datePosted:'2026-10-23',hiringOrganization:{name:'Example'},jobLocationType:'TELECOMMUTE',applicantLocationRequirements:{'@type':'Country',name:'US'}};
    const html=`<script type="application/ld+json">${JSON.stringify({'@graph':[posting]})}</script>`;
    expect(jobPostingEvidence(html)).toMatchObject({jobPosting:true,missing:[]});
    expect(jobPostingEvidence('<script type="application/ld+json">{"@type":"NotJobPosting"}</script>').jobPosting).toBe(false);
  });
  it('redacts arbitrary parser and credential failures at the CLI boundary', () => {
    expect(publicGoogleError(new SyntaxError('fixture-private-body'))).not.toContain('fixture-private-body');
    expect(publicGoogleError(new Error('Search Console SearchAnalytics API HTTP 403'))).toContain('403');
  });
});

 it('reads inert visible JobPosting microdata without borrowing unrelated properties', () => {
   const html='<main itemscope itemtype="https://schema.org/JobPosting"><h1 itemprop="title">Engineer</h1><time itemprop="datePosted" datetime="2026-10-24">Today</time><div itemprop="description"><p>Full visible description.</p></div><span itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization"><span itemprop="name">Example</span></span><meta itemprop="jobLocationType" content="TELECOMMUTE"><span itemprop="applicantLocationRequirements" itemscope itemtype="https://schema.org/Country"><span itemprop="name">US</span></span></main>';
   expect(jobPostingEvidence(html)).toEqual({jobPosting:true,missing:[]});
   expect(jobPostingEvidence(html.replace('itemprop="description"','data-description="outside"')).missing).toContain('description');
   expect(jobPostingEvidence('<div itemprop="title">Unrelated</div><main itemscope itemtype="https://schema.org/JobPosting"><div itemprop="hiringOrganization" itemscope><span itemprop="title">Wrong scope</span></div></main>').missing).toContain('title');
 });
