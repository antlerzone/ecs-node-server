"use client"

import { motion } from "framer-motion"
import { FOR_OWNERS_FAQ_ITEMS } from "@/lib/for-owners-faq"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

export function ForOwnersFaqSection() {
  return (
    <section className="py-20 md:py-28 px-6 border-t border-border bg-muted/30">
      <div className="max-w-3xl mx-auto">
        <motion.span
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-xs font-bold tracking-[0.3em] uppercase mb-4 block"
          style={{ color: "var(--brand)" }}
        >
          FAQ
        </motion.span>
        <motion.h2
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-4xl font-black text-foreground text-balance mb-10"
        >
          Questions from property owners & operators
        </motion.h2>
        <Accordion type="single" collapsible className="w-full">
          {FOR_OWNERS_FAQ_ITEMS.map((item, i) => (
            <AccordionItem key={i} value={`item-${i}`} className="border-border">
              <AccordionTrigger className="text-left text-base font-semibold hover:no-underline py-5">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-5">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
