import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

// Searchable dropdown for selecting a Course / Job Role from the master.
// Search matches name / qp_code / sector / sub_sector (cmdk value).
export default function CourseCombobox({ courses, value, onSelect, onAddNew, canAdd, className, testid }) {
  const [open, setOpen] = useState(false);
  const selected = courses.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline" role="combobox" aria-expanded={open}
          className={cn("h-7 justify-between text-[11px] font-normal min-w-[180px]", className)}
          data-testid={testid}
        >
          <span className="truncate">{selected ? selected.name : "Select Job Role / Course"}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command
          filter={(val, search) => (val.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder="Search by role, QP, sector…" className="text-xs" data-testid="course-combo-search" />
          <CommandList>
            <CommandEmpty>No course found.</CommandEmpty>
            <CommandGroup>
              {courses.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.qp_code || ""} ${c.sector || ""} ${c.sub_sector || ""}`}
                  onSelect={() => { onSelect(c); setOpen(false); }}
                  data-testid={`course-combo-item-${c.id}`}
                >
                  <Check className={cn("mr-2 h-3 w-3", value === c.id ? "opacity-100" : "opacity-0")} />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">{c.name}</span>
                    <span className="text-[10px] text-[var(--muted)]">
                      {[c.qp_code, c.sector, c.category ? `Cat ${c.category}` : "", c.nsqf_level ? `NSQF ${c.nsqf_level}` : ""].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {canAdd && (
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full justify-start text-[11px] h-7"
                onClick={() => { setOpen(false); onAddNew && onAddNew(); }} data-testid="course-combo-add-new">
                <Plus size={12} className="mr-1" /> Add New Course
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
